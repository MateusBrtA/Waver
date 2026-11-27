// Caminho da mídia na call (ICE) e como preferir o caminho mais curto.
//
// Por que o ping alto: duas pessoas em cidades diferentes "na mesma LAN" quase sempre estão numa VPN de jogos
// (Radmin VPN 26.x.x.x, Hamachi 25.x.x.x). Quando a VPN não consegue ligar os dois PCs direto, ela passa tudo
// pelos servidores dela, que podem estar longe (BH -> Goiás vira ~300 ms). O WebRTC prefere sempre o endereço
// "host" (a placa da VPN) a um caminho direto pela internet (STUN), mesmo quando o direto é muito mais rápido.
//
// Aqui o endereço da VPN que chega do outro lado ganha prioridade MENOR que o caminho direto pela internet
// (e maior que um TURN). Se o caminho direto funcionar (furo de NAT pelo STUN), a mídia vai direto entre as
// duas cidades, sem passar pela VPN; se não funcionar, continua pela VPN como antes. Nada para de funcionar.

/** faixas usadas por VPNs de jogos que encaminham pela nuvem delas */
export function vpnKind(ip: string): 'radmin' | 'hamachi' | 'tailscale' | null {
  const m = /^(\d+)\.(\d+)\./.exec(ip || '');
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 26) return 'radmin';
  if (a === 25) return 'hamachi';
  if (a === 100 && b >= 64 && b <= 127) return 'tailscale';
  return null;
}

function isPrivateLan(ip: string) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fd|fe80:)/i.test(ip || '');
}

// prioridade = (preferência do tipo << 24) | (local << 8) | (256 - componente). STUN direto (srflx) = 100,
// TURN = 0. A VPN fica com 40: abaixo do direto, acima do TURN.
const VPN_TYPE_PREF = 40;

/** Reescreve a prioridade de um candidato "host" de VPN (string "candidate:..."). */
export function deprioritizeVpnCandidateLine(line: string): string {
  // candidate:<foundation> <component> <proto> <priority> <ip> <port> typ <type> ...
  const parts = line.split(' ');
  if (parts.length < 8 || parts[6] !== 'typ' || parts[7] !== 'host') return line;
  const kind = vpnKind(parts[4]);
  // Tailscale costuma ser direto (e tem relé no Brasil): só Radmin/Hamachi descem
  if (kind !== 'radmin' && kind !== 'hamachi') return line;
  const component = Number(parts[1]) || 1;
  const prio = VPN_TYPE_PREF * 2 ** 24 + 65535 * 2 ** 8 + (256 - component);
  if (String(prio) === parts[3]) return line;
  parts[3] = String(prio);
  return parts.join(' ');
}

export function deprioritizeVpnCandidate(c: RTCIceCandidateInit): RTCIceCandidateInit {
  if (!c?.candidate) return c;
  const prefix = c.candidate.startsWith('a=') ? 'a=' : '';
  const body = prefix ? c.candidate.slice(2) : c.candidate;
  const next = deprioritizeVpnCandidateLine(body);
  return next === body ? c : { ...c, candidate: prefix + next };
}

export function deprioritizeVpnInSdp(sdp: string | undefined): string | undefined {
  if (!sdp || !/a=candidate:/.test(sdp)) return sdp;
  return sdp
    .split('\r\n')
    .map((l) => (l.startsWith('a=candidate:') ? 'a=' + deprioritizeVpnCandidateLine(l.slice(2)) : l))
    .join('\r\n');
}

export type MediaPath = 'lan' | 'direct' | 'vpn' | 'relay';

export interface PathInfo {
  rttMs: number;
  path: MediaPath | null;
  /** host = mesma rede (endereço local) */
  isLan: boolean;
}

/**
 * Lê o par de candidatos que está de fato em uso (selectedCandidatePairId), e não qualquer par "succeeded":
 * antes o ping mostrado podia ser o de um caminho reserva, e não o do caminho da mídia.
 */
export function readSelectedPath(stats: RTCStatsReport): PathInfo {
  let pairId: string | null = null;
  const pairs: any[] = [];
  const cands = new Map<string, any>();
  stats.forEach((r: any) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
    if (r.type === 'candidate-pair') pairs.push(r);
    if (r.type === 'local-candidate' || r.type === 'remote-candidate') cands.set(r.id, r);
  });
  let pair = pairId ? pairs.find((p) => p.id === pairId) : null;
  if (!pair) pair = pairs.find((p) => p.selected) || pairs.find((p) => p.nominated && p.state === 'succeeded') || null;
  if (!pair) return { rttMs: 0, path: null, isLan: false };
  const rttMs = typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : 0;
  const local = cands.get(pair.localCandidateId);
  const remote = cands.get(pair.remoteCandidateId);
  const ltype = local?.candidateType;
  const rtype = remote?.candidateType;
  const lip = local?.address || local?.ip || '';
  const rip = remote?.address || remote?.ip || '';
  let path: MediaPath;
  if (ltype === 'relay' || rtype === 'relay') path = 'relay';
  else if (vpnKind(lip) || vpnKind(rip)) path = 'vpn';
  else if (ltype === 'host' && rtype === 'host' && (isPrivateLan(lip) || isPrivateLan(rip) || !rip)) path = 'lan';
  else path = 'direct';
  return { rttMs, path, isLan: path === 'lan' };
}

export const PATH_LABEL: Record<MediaPath, string> = {
  lan: 'LAN',
  direct: 'Direto',
  vpn: 'VPN',
  relay: 'Relé',
};
