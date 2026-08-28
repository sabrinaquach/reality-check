/**
 * Which cities the safety pillar can answer for.
 *
 * It sits wherever safety is being reported -- under the neighbourhood rail on
 * the board, under the safety card on a reality check, and under the safety
 * row of a breakdown -- because that is where the question occurs to someone.
 * Stated at the top of the page instead, it was a disclaimer nobody had a
 * reason to read yet.
 *
 * The list is the server's (see cities.ts); this only decides the sentence.
 * Empty until /api/me answers, which is why it renders nothing rather than a
 * sentence with a hole in it.
 */
export function Coverage({ cities }: { cities: string[] }) {
  if (cities.length === 0) return null;
  return (
    <p className="coverage">
      Safety covers {cities.slice(0, -1).join(", ")} and {cities[cities.length - 1]}.
    </p>
  );
}
