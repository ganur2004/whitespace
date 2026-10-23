export type EntityKind = "anchor" | "competitor" | "place";

export interface Entity {
  token: string;
  id: string;
  name: string;
  kind: EntityKind;
}

const PREFIX: Record<EntityKind, string> = { anchor: "a", competitor: "c", place: "p" };

export class EntityRegistry {
  private readonly byToken = new Map<string, Entity>();
  private readonly byId = new Map<string, Entity>();
  private readonly counters: Record<EntityKind, number> = { anchor: 0, competitor: 0, place: 0 };

  add(kind: EntityKind, id: string, name: string): string {
    const known = this.byId.get(id);
    if (known) return known.token;
    this.counters[kind] += 1;
    const entity: Entity = { token: `${PREFIX[kind]}${this.counters[kind]}`, id, name, kind };
    this.byToken.set(entity.token, entity);
    this.byId.set(id, entity);
    return entity.token;
  }

  ref(kind: EntityKind, id: string, name: string): string {
    return `[[${this.add(kind, id, name)}]]`;
  }

  get(token: string): Entity | undefined {
    return this.byToken.get(token);
  }

  byIdOf(id: string): Entity | undefined {
    return this.byId.get(id);
  }

  all(): Entity[] {
    return [...this.byToken.values()];
  }

  find(text: string): Entity | undefined {
    const wanted = text.trim().replace(/^\[\[|\]\]$/g, "");
    const token = this.byToken.get(wanted);
    if (token) return token;
    const lower = wanted.toLowerCase();
    if (!lower) return undefined;
    return (
      this.all().find((entity) => entity.name.toLowerCase() === lower) ??
      this.all().find((entity) => entity.name.toLowerCase().includes(lower)) ??
      this.all().find((entity) => lower.includes(entity.name.toLowerCase()))
    );
  }
}

export type Rendered = { ok: true; text: string } | { ok: false; problems: string[] };

const TOKEN = /\[\[([a-z]\d+)\]\]/g;
const CAPITALIZED_RUN = /\b[A-Z][\p{L}'’&-]*(?:\s+[A-Z][\p{L}'’&-]*)+/gu;
const MIN_NAME_LENGTH = 4;

const COMMON_WORDS = new Set(
  [
    "a",
    "an",
    "and",
    "as",
    "at",
    "audience",
    "both",
    "but",
    "by",
    "check",
    "compared",
    "each",
    "either",
    "for",
    "from",
    "here",
    "if",
    "in",
    "it",
    "its",
    "locals",
    "most",
    "my",
    "neither",
    "next",
    "no",
    "note",
    "of",
    "on",
    "or",
    "our",
    "overall",
    "so",
    "taste",
    "that",
    "the",
    "their",
    "then",
    "there",
    "these",
    "this",
    "those",
    "to",
    "top",
    "visit",
    "we",
    "with",
    "you",
    "your",
    "zone",
    "zones",
  ].map((word) => word.toLowerCase()),
);

export function render(
  text: string,
  registry: EntityRegistry,
  allowedNames: readonly string[],
): Rendered {
  const problems: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const token = match[1] ?? "";
    if (!registry.get(token)) problems.push(`[[${token}]] is not an entity from the data`);
  }

  const plain = text.replace(TOKEN, " ");
  const allowed = allowedNames.map((name) => name.toLowerCase()).filter(Boolean);
  for (const entity of registry.all()) {
    if (entity.name.length >= MIN_NAME_LENGTH && plain.includes(entity.name)) {
      problems.push(`write [[${entity.token}]] instead of the name "${entity.name}"`);
    }
  }
  for (const match of plain.matchAll(CAPITALIZED_RUN)) {
    const words = match[0].split(/\s+/);
    while (words.length > 0 && COMMON_WORDS.has((words[0] ?? "").toLowerCase())) words.shift();
    if (words.length < 2) continue;
    const phrase = words.join(" ");
    const lower = phrase.toLowerCase();
    if (allowed.some((name) => name === lower || name.includes(lower) || lower.includes(name))) {
      continue;
    }
    if (registry.all().some((entity) => entity.name.toLowerCase().includes(lower))) {
      problems.push(`"${phrase}" must be written as its [[id]] token`);
    } else {
      problems.push(`"${phrase}" is not a name from the data`);
    }
  }

  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  return {
    ok: true,
    text: text.replace(TOKEN, (_, token: string) => registry.get(token)?.name ?? ""),
  };
}

export function substitute(text: string, registry: EntityRegistry): string {
  return text.replace(TOKEN, (_, token: string) => registry.get(token)?.name ?? "");
}
