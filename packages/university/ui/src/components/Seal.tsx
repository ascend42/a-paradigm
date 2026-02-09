interface SealProps {
  size?: number;
  className?: string;
}

export function Seal({ size = 120, className = '' }: SealProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer ring */}
      <circle cx="100" cy="100" r="95" stroke="#C5A572" strokeWidth="2" fill="none" />
      <circle cx="100" cy="100" r="88" stroke="#C5A572" strokeWidth="1" fill="none" />

      {/* Laurel wreath - left */}
      <path d="M35 100 C40 80, 50 65, 55 55" stroke="#4A7C59" strokeWidth="1.5" fill="none" />
      <ellipse cx="42" cy="85" rx="6" ry="10" transform="rotate(-20 42 85)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <ellipse cx="47" cy="72" rx="6" ry="10" transform="rotate(-30 47 72)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <ellipse cx="54" cy="61" rx="5" ry="9" transform="rotate(-40 54 61)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <path d="M35 100 C40 120, 50 135, 55 145" stroke="#4A7C59" strokeWidth="1.5" fill="none" />
      <ellipse cx="42" cy="115" rx="6" ry="10" transform="rotate(20 42 115)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <ellipse cx="47" cy="128" rx="6" ry="10" transform="rotate(30 47 128)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <ellipse cx="54" cy="139" rx="5" ry="9" transform="rotate(40 54 139)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />

      {/* Laurel wreath - right */}
      <path d="M165 100 C160 80, 150 65, 145 55" stroke="#4A7C59" strokeWidth="1.5" fill="none" />
      <ellipse cx="158" cy="85" rx="6" ry="10" transform="rotate(20 158 85)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <ellipse cx="153" cy="72" rx="6" ry="10" transform="rotate(30 153 72)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <ellipse cx="146" cy="61" rx="5" ry="9" transform="rotate(40 146 61)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <path d="M165 100 C160 120, 150 135, 145 145" stroke="#4A7C59" strokeWidth="1.5" fill="none" />
      <ellipse cx="158" cy="115" rx="6" ry="10" transform="rotate(-20 158 115)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <ellipse cx="153" cy="128" rx="6" ry="10" transform="rotate(-30 153 128)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />
      <ellipse cx="146" cy="139" rx="5" ry="9" transform="rotate(-40 146 139)" fill="#4A7C5930" stroke="#4A7C59" strokeWidth="0.8" />

      {/* Open book icon */}
      <path d="M80 90 L100 85 L120 90 L120 115 L100 110 L80 115 Z" fill="#FDF8F020" stroke="#6B1C23" strokeWidth="1.5" />
      <line x1="100" y1="85" x2="100" y2="110" stroke="#6B1C23" strokeWidth="1" />
      {/* Book lines */}
      <line x1="85" y1="95" x2="97" y2="92" stroke="#6B1C2340" strokeWidth="0.5" />
      <line x1="85" y1="99" x2="97" y2="96" stroke="#6B1C2340" strokeWidth="0.5" />
      <line x1="85" y1="103" x2="97" y2="100" stroke="#6B1C2340" strokeWidth="0.5" />
      <line x1="103" y1="92" x2="115" y2="95" stroke="#6B1C2340" strokeWidth="0.5" />
      <line x1="103" y1="96" x2="115" y2="99" stroke="#6B1C2340" strokeWidth="0.5" />
      <line x1="103" y1="100" x2="115" y2="103" stroke="#6B1C2340" strokeWidth="0.5" />

      {/* Five symbol dots above book */}
      <circle cx="80" cy="78" r="3" fill="#6B1C23" /> {/* # */}
      <circle cx="90" cy="74" r="3" fill="#2D5F8A" /> {/* $ */}
      <circle cx="100" cy="72" r="3" fill="#7B5EA7" /> {/* ^ */}
      <circle cx="110" cy="74" r="3" fill="#B8860B" /> {/* ! */}
      <circle cx="120" cy="78" r="3" fill="#4A7C59" /> {/* ~ */}

      {/* Outer text - top arc: UNIVERSITAS PARADIGMATICA */}
      <path id="textArcTop" d="M 30 100 A 70 70 0 0 1 170 100" fill="none" />
      <text fontFamily="'Crimson Pro', Georgia, serif" fontSize="11" fill="#6B1C23" fontWeight="600" letterSpacing="3">
        <textPath href="#textArcTop" startOffset="50%" textAnchor="middle">
          UNIVERSITAS PARADIGMATICA
        </textPath>
      </text>

      {/* Outer text - bottom arc: LUX IN CODICE */}
      <path id="textArcBottom" d="M 45 130 A 65 65 0 0 0 155 130" fill="none" />
      <text fontFamily="'Crimson Pro', Georgia, serif" fontSize="10" fill="#C5A572" fontWeight="500" fontStyle="italic" letterSpacing="2">
        <textPath href="#textArcBottom" startOffset="50%" textAnchor="middle">
          LUX IN CODICE
        </textPath>
      </text>

      {/* Small decorative stars */}
      <circle cx="50" cy="100" r="2" fill="#C5A572" />
      <circle cx="150" cy="100" r="2" fill="#C5A572" />
    </svg>
  );
}
