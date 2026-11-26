/** Logo do Waver (o Wavy): balão de conversa com sorriso e topete de onda sonora. Mesmo desenho de brand/waver-icon-small.svg. */
export function WaverLogo({ className = 'w-4 h-4', title = 'Waver' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label={title}>
      <rect x="0" y="0" width="512" height="512" rx="128" fill="#12b3a8" />
      <g fill="#ffffff">
        <rect x="60" y="96" width="392" height="300" rx="150" />
        <path d="M126 350 L86 450 Q82 462 94 456 L222 384 Z" />
      </g>
      <ellipse cx="190" cy="214" rx="34" ry="46" fill="#12b3a8" />
      <ellipse cx="322" cy="214" rx="34" ry="46" fill="#12b3a8" />
      <path d="M198 298 q58 50 116 0" fill="none" stroke="#12b3a8" strokeWidth="30" strokeLinecap="round" />
    </svg>
  );
}
