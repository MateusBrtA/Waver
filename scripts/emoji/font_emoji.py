"""Lê a fonte Segoe UI Emoji (só leitura) e lista as sequências de emoji que ela desenha:
cmap (formato 12/4) + ligaduras do GSUB (tipo 4, também dentro do tipo 7). Saída: JSON com as sequências."""
import json, struct, sys

path, OUTFILE = sys.argv[1], sys.argv[2]
data = open(path, 'rb').read()

def u16(o): return struct.unpack_from('>H', data, o)[0]
def u32(o): return struct.unpack_from('>I', data, o)[0]

num_tables = u16(4)
tables = {}
for i in range(num_tables):
    rec = 12 + 16 * i
    tag = data[rec:rec + 4].decode('latin1')
    tables[tag] = (u32(rec + 8), u32(rec + 12))

# ---- cmap ----
cmap_off = tables['cmap'][0]
n = u16(cmap_off + 2)
cp2g = {}
best = None
for i in range(n):
    pid, eid, off = u16(cmap_off + 4 + 8 * i), u16(cmap_off + 6 + 8 * i), u32(cmap_off + 8 + 8 * i)
    fmt = u16(cmap_off + off)
    if fmt == 12:
        best = cmap_off + off
if best is None:
    raise SystemExit('sem cmap formato 12')
ngroups = u32(best + 12)
for g in range(ngroups):
    s, e, start = u32(best + 16 + 12 * g), u32(best + 20 + 12 * g), u32(best + 24 + 12 * g)
    for k in range(e - s + 1):
        cp2g[s + k] = start + k
g2cp = {}
for cp, g in cp2g.items():
    g2cp.setdefault(g, cp)

# ---- COLR: glifos coloridos (emoji de verdade) ----
colr_glyphs = set()
if 'COLR' in tables:
    co = tables['COLR'][0]
    nbase = u16(co + 2)
    boff = u32(co + 4)
    for i in range(nbase):
        colr_glyphs.add(u16(co + boff + 6 * i))

# ---- GSUB ligaduras ----
gs = tables['GSUB'][0]
lookup_list = gs + u16(gs + 8)
nlook = u16(lookup_list)

def coverage(off):
    fmt = u16(off)
    res = []
    if fmt == 1:
        c = u16(off + 2)
        res = [u16(off + 4 + 2 * i) for i in range(c)]
    else:
        c = u16(off + 2)
        for i in range(c):
            s, e = u16(off + 4 + 6 * i), u16(off + 6 + 6 * i)
            res.extend(range(s, e + 1))
    return res

ligs = []  # (lista de glifos, glifo resultado)
singles = {}

def handle(ltype, st):
    if ltype == 7:
        et = u16(st + 2)
        handle(et, st + u32(st + 4))
        return
    if ltype == 4:
        cov = coverage(st + u16(st + 2))
        nset = u16(st + 4)
        for i in range(nset):
            first = cov[i]
            so = st + u16(st + 6 + 2 * i)
            nl = u16(so)
            for j in range(nl):
                lo = so + u16(so + 2 + 2 * j)
                lig = u16(lo)
                cc = u16(lo + 2)
                comps = [u16(lo + 4 + 2 * k) for k in range(cc - 1)]
                ligs.append(([first] + comps, lig))
    elif ltype == 1:
        fmt = u16(st)
        cov = coverage(st + u16(st + 2))
        if fmt == 1:
            d = struct.unpack_from('>h', data, st + 4)[0]
            for g in cov:
                singles.setdefault(g, (g + d) & 0xFFFF)
        else:
            c = u16(st + 4)
            for i in range(c):
                singles.setdefault(cov[i], u16(st + 6 + 2 * i))

for i in range(nlook):
    lo = lookup_list + u16(lookup_list + 2 + 2 * i)
    ltype = u16(lo)
    nsub = u16(lo + 4)
    for j in range(nsub):
        handle(ltype, lo + u16(lo + 6 + 2 * j))

# glifos intermediários (vindos de substituições simples) mapeiam de volta para o código original
inter = {}
for src, dst in singles.items():
    if src in g2cp and dst not in g2cp:
        inter[dst] = g2cp[src]

def to_cp(g):
    if g in g2cp: return g2cp[g]
    if g in inter: return inter[g]
    return None

# ligaduras encadeadas: um glifo de ligadura pode ser componente de outra
lig_seq = {}
changed = True
while changed:
    changed = False
    for comps, lig in ligs:
        if lig in lig_seq: continue
        out = []
        ok = True
        for g in comps:
            c = to_cp(g)
            if c is not None: out.append(c)
            elif g in lig_seq: out.extend(lig_seq[g])
            else: ok = False; break
        if ok:
            lig_seq[lig] = out
            changed = True
seqs = list(lig_seq.values())
unresolved = len(ligs) - len(lig_seq)

singles_cp = sorted(cp for cp, g in cp2g.items() if cp > 0x7f)
json.dump({'singles': singles_cp, 'seqs': seqs, 'colr': len(colr_glyphs), 'unresolved': unresolved}, open(OUTFILE, "w"))
print('cmap', len(cp2g), 'ligs', len(ligs), 'seqs', len(seqs), 'unresolved', unresolved, 'colr', len(colr_glyphs), 'singles subst', len(singles))
