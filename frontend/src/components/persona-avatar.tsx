import type { TargetPersona } from "@/lib/api";

export type AgeBand = "child" | "young" | "adult" | "senior";

/** The persona's age band, from the middle of its age range. */
export function ageBand(ageMin: number, ageMax: number): AgeBand {
  const age = (ageMin + ageMax) / 2;
  if (age < 13) return "child";
  if (age < 30) return "young";
  if (age < 55) return "adult";
  return "senior";
}

const SKIN = "#f1c7a0";
const SKIN_SHADE = "#e3b08a";
const HAIR = { child: "#5a3a22", young: "#2f2119", adult: "#463224", senior: "#c9c9c9" } as const;
// Clothes, one per persona position, so side-by-side heads are easy to tell apart.
const SHIRTS = ["#2a78d6", "#eb6834", "#2e9e6a", "#8a56c9", "#d4a017"];

/**
 * A simple drawn head for a persona: the hairstyle follows the gender, and
 * the age band changes the proportions, hair colour and details (grey hair,
 * glasses and lines for seniors). Illustrative only -- not a real person.
 */
export function PersonaAvatar({
  persona,
  index,
  size = 64,
  label,
}: {
  persona: Pick<TargetPersona, "age_min" | "age_max" | "gender">;
  index: number;
  size?: number;
  /** Accessible description; omit when the avatar is decorative. */
  label?: string;
}) {
  const band = ageBand(persona.age_min, persona.age_max);
  const hair = HAIR[band];
  const shirt = SHIRTS[index % SHIRTS.length];
  const child = band === "child";
  const senior = band === "senior";
  // A child's head is a little larger and sits lower.
  const headR = child ? 15 : 13;
  const headY = child ? 30 : 27;
  const eyeY = headY + 1;
  const gender = persona.gender;

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-age-band={band}
      data-gender={gender}
    >
      <circle cx="32" cy="32" r="32" fill={gender === "any" ? "#e8edf3" : "#eef3fb"} />

      {/* Long hair falls behind the shoulders (women), medium (non-binary). */}
      {gender === "female" && (
        <path d={`M${32 - headR - 2} ${headY} Q32 ${headY - headR - 8} ${32 + headR + 2} ${headY} L${32 + headR + 3} ${headY + 19} L${32 - headR - 3} ${headY + 19} Z`} fill={hair} />
      )}
      {gender === "non_binary" && (
        <path d={`M${32 - headR - 2} ${headY} Q32 ${headY - headR - 8} ${32 + headR + 2} ${headY} L${32 + headR + 2} ${headY + 9} L${32 - headR - 2} ${headY + 9} Z`} fill={hair} />
      )}

      {/* Shoulders and neck */}
      <path d="M10 64 Q12 48 32 47 Q52 48 54 64 Z" fill={shirt} />
      <rect x="28" y={headY + headR - 4} width="8" height="8" rx="2" fill={SKIN_SHADE} />

      {/* Head and ears */}
      <circle cx={32 - headR} cy={eyeY + 1} r="2.6" fill={SKIN_SHADE} />
      <circle cx={32 + headR} cy={eyeY + 1} r="2.6" fill={SKIN_SHADE} />
      <circle cx="32" cy={headY} r={headR} fill={SKIN} />

      {/* Hair on top */}
      {gender === "male" &&
        (senior ? (
          // Receding: hair on the sides only.
          <>
            <path d={`M${32 - headR} ${headY - 2} Q${32 - headR + 2} ${headY - headR + 2} ${32 - headR + 7} ${headY - headR + 3}`} stroke={hair} strokeWidth="4" fill="none" strokeLinecap="round" />
            <path d={`M${32 + headR} ${headY - 2} Q${32 + headR - 2} ${headY - headR + 2} ${32 + headR - 7} ${headY - headR + 3}`} stroke={hair} strokeWidth="4" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <path d={`M${32 - headR} ${headY - 1} Q${32 - headR} ${headY - headR - 4} 32 ${headY - headR - 3} Q${32 + headR} ${headY - headR - 4} ${32 + headR} ${headY - 1} Q32 ${headY - headR + 3} ${32 - headR} ${headY - 1} Z`} fill={hair} />
        ))}
      {(gender === "female" || gender === "non_binary") && (
        // Fringe
        <path d={`M${32 - headR} ${headY - 1} Q${32 - headR + 1} ${headY - headR - 3} 32 ${headY - headR - 2} Q${32 + headR - 1} ${headY - headR - 3} ${32 + headR} ${headY + 1} Q${32 + 4} ${headY - headR + 6} ${32 - 3} ${headY - headR + 4} Q${32 - headR + 4} ${headY - headR + 6} ${32 - headR} ${headY - 1} Z`} fill={hair} />
      )}
      {gender === "any" && (
        // A neutral, ear-length cut with a side parting.
        <path
          d={`M${32 - headR - 1} ${headY + 4} Q${32 - headR - 2} ${headY - headR - 3} 32 ${headY - headR - 3} Q${32 + headR + 2} ${headY - headR - 3} ${32 + headR + 1} ${headY + 4} L${32 + headR - 2} ${headY + 4} Q${32 + headR - 2} ${headY - headR + 5} ${32 - 2} ${headY - headR + 3} Q${32 - headR + 3} ${headY - headR + 6} ${32 - headR + 2} ${headY + 4} Z`}
          fill={hair}
        />
      )}

      {/* Face */}
      <circle cx="27" cy={eyeY} r="1.5" fill="#2b2b2b" />
      <circle cx="37" cy={eyeY} r="1.5" fill="#2b2b2b" />
      <path d={`M28 ${eyeY + 6} Q32 ${eyeY + 9} 36 ${eyeY + 6}`} stroke="#a0522d" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {child && (
        <>
          <circle cx="24.5" cy={eyeY + 4} r="2" fill="#f4a3a3" opacity="0.7" />
          <circle cx="39.5" cy={eyeY + 4} r="2" fill="#f4a3a3" opacity="0.7" />
        </>
      )}
      {senior && (
        <>
          {/* Glasses and forehead lines */}
          <circle cx="27" cy={eyeY} r="3.6" stroke="#4b5563" strokeWidth="1.1" fill="none" />
          <circle cx="37" cy={eyeY} r="3.6" stroke="#4b5563" strokeWidth="1.1" fill="none" />
          <path d={`M30.6 ${eyeY} H33.4`} stroke="#4b5563" strokeWidth="1.1" />
          <path d={`M27 ${headY - 7} Q32 ${headY - 8.5} 37 ${headY - 7}`} stroke={SKIN_SHADE} strokeWidth="1" fill="none" />
        </>
      )}
    </svg>
  );
}
