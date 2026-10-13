import {
  describeAnchorAudience,
  describeAudience,
  type AudiencePortrait,
} from "@whitespace/shared";

export interface AudiencePanelProps {
  audience: AudiencePortrait;
  anchorNames: Readonly<Record<string, string>>;
}

export function AudiencePanel({ audience, anchorNames }: AudiencePanelProps): React.JSX.Element {
  const order = Object.keys(anchorNames);
  const rank = (anchorId: string) => {
    const index = order.indexOf(anchorId);
    return index === -1 ? order.length : index;
  };
  const entries = [...audience.byAnchor].sort((a, b) => rank(a.anchorId) - rank(b.anchorId));
  return (
    <section className="audience" aria-label="Audience portrait">
      <span className="field-label">Who this taste attracts</span>
      <p className="audience-summary">{describeAudience(audience)}</p>
      <details className="audience-anchors">
        <summary className="small">By anchor ({audience.byAnchor.length})</summary>
        <ul>
          {entries.map((entry) => (
            <li key={entry.anchorId}>
              <span className="audience-anchor">{anchorNames[entry.anchorId] ?? "Anchor"}</span>
              <span className="muted">{describeAnchorAudience(entry)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
