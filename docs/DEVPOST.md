# Devpost submission: Whitespace

Text for the Devpost project page. Each section below maps to a field of the submission form. Devpost's editor renders Markdown but not tables, so the story uses lists only.

## Project name

Whitespace

## Elevator pitch

An agent that finds where your new venue's audience already lives and goes out, but its competitors don't, using a city-wide Qloo taste heatmap and taste-weighted competition.

## Links

- Live demo: https://d3qszcalamj7w3.cloudfront.net
- Code: https://github.com/ganur2004/whitespace (make the repository public before submitting)
- Video: TODO: add the video URL

## Built with

typescript, react, maplibre, openfreemap, node.js, hono, anthropic, claude, qloo, vitest, docker

## About the project

### Inspiration

Choosing a location is the most expensive decision a new venue makes, and the classic inputs are foot traffic, demographics and rent. They tell you how many people are nearby. They don't tell you whether those people will love _your_ concept. A ramen bar with a vinyl listening corner and craft beer and a family café can share the same street and the same traffic, and have opposite fates.

Qloo knows what people love across dining, music, brands and more, and where those people are. We wanted an agent that uses that to answer the question owners actually ask: _where in this city should I open?_

### What it does

1. You describe a concept in plain words, optionally name venues like yours, and pick a city (Austin, Brooklyn or Chicago).
2. The agent turns the concept into **taste anchors** found in Qloo: similar venues, artists and brands. For the example concept in Austin that is Ramen Tatsu-Ya, Kitty Cohen's, Khruangbin and Lagunitas.
3. Qloo's **taste heatmap** shows how strongly every ~150 m cell of the city matches that taste.
4. Whitespace finds every **competitor** of the main category (ramen restaurants) and asks Qloo how much the same audience likes each one. A rival your audience loves counts more than a random venue of the same type.
5. The scoring model combines audience and competition into an **opportunity** map and picks the **top 3 zones**. Each zone card shows its neighborhood, how high the taste match ranks in the city, how many similar venues are close compared with typical areas for this audience, the places locals with this taste love, which anchors drive the match, and a short brief.
6. An **audience portrait** from Qloo demographics shows who the concept attracts, overall and per anchor.
7. You keep talking to the agent: _"Exclude downtown, rent is too high there"_, _"Compare zone 1 and zone 2"_, _"I'm less worried about competition"_, _"Why is this place on the list?"_ The agent changes the analysis and the map updates.
8. A competition slider recomputes the zones instantly in the browser.
9. **Download brief** exports a Markdown report with the map, zones, reasons and closest competitors.
10. The **Trace panel** ("How Whitespace used Qloo") lists every Qloo call with its endpoint, parameters, result count, time and cache status.

### Who it's for

- Small business owners opening a first or second location.
- Franchisees and chain managers choosing a neighborhood.
- Commercial real estate brokers who need to justify a location to a client.

Whitespace is a first filter before the expensive part of site selection: it narrows a whole city to three neighborhoods worth visiting, with reasons.

### Why it only works with Qloo

Without Qloo, Whitespace is a map of competitors, which any mapping service already gives you. Every part that makes it useful comes from Qloo's taste graph:

- **A taste heatmap for this exact concept.** Qloo returns a percentile taste match for every geohash-7 cell of the city: about 1,650 cells in Austin, 2,200 in Brooklyn and 2,600 in Chicago, for the specific venues, artists and brands that describe the concept. This is not population density. We checked: the heatmaps for a ramen bar and a family café in Austin have a Spearman correlation of only 0.51, and their top 5% of cells overlap by just 10%.
- **Cross-domain taste.** The concept is described by a restaurant, a band and a beer brand at the same time, and Qloo links them into one audience. No census table or map can do that.
- **Taste-weighted competition.** For each competitor, `filter.results.entities` with the anchors as a signal tells us how much the same audience likes it.
- **Explanations from data, not from the LLM.** Qloo explainability tells us which anchors drive each place's match; demographics tell us who the audience is. The agent can only cite these facts.

### How it's different from location-analysis agents

The grand prize of Qloo's 2025 hackathon went to GeoTaste, a business consultant agent that analyzes the business environment of a location you choose, with charts and a chat. It showed that Qloo is a strong fit for location intelligence. Whitespace answers the inverse question and works differently:

- **Concept first, not location first.** GeoTaste starts from a place you already have in mind and describes it. Whitespace starts from your concept and searches the whole city for where it fits.
- **The taste signal is yours.** The heatmap is built from your concept's own anchors, so two concepts in the same city get different maps.
- **Competition is weighted by your audience.** Rivals are not just counted around a point; each one weighs as much as your audience likes it.
- **Ranked, comparable zones with reasons computed by code.** The reasons on every card are numbers from Qloo and from the scoring model, not paragraphs written by an LLM.
- **Grounded agent.** The LLM can only name places, artists and brands that Qloo returned in the current analysis.
- **The chat changes the analysis.** Excluding an area, re-weighting competition, swapping anchors and comparing zones are agent tools that recompute the result, not follow-up questions.

### How we built it

A deterministic pipeline does the first analysis, so the result is reproducible; the agent works around it. Every Qloo call goes through one client and is recorded for the Trace panel.

**Pipeline**

- **Concept to anchors.** The LLM turns the concept into search phrases across at least two entity types, using structured output with a JSON schema. It never invents ids. `GET /search` finds each anchor; venues the user named are searched near the city center with `sort_by=match` to get the right branch.
- **Category tag.** `GET /v2/tags` with typo tolerance, and semantic search as a fallback, finds the competitor genre, for example `urn:tag:genre:place:restaurant:ramen`.
- **Heatmap.** `GET /v2/insights` with `filter.type=urn:heatmap`, the city's locality id and the anchors as `signal.interests.entities`. We clip it to the city, then smooth each cell with its 8 neighbors and turn it back into a percentile, because single spikes such as the airport would otherwise become zones.
- **Competitors.** All venues with the category tag in the city (`urn:entity:place`, `filter.tags`, paging), then their taste match through `filter.results.entities` with the anchors as a signal, in batches of 50 ids.
- **Audience portrait.** `urn:demographics` with the anchors. Qloo returns demographics per anchor, and anchors can pull very different audiences (in Austin, Ramen Tatsu-Ya leans 25 to 29 and Lagunitas 55+), so we show both the overall lean and the per-anchor breakdown.
- **Zone profiles.** `urn:entity:place` with the zone's WKT polygon as `filter.location`, the anchors as a signal and `feature.explainability=true`. Competitors and hotels are filtered out, so "locals love" is about the neighborhood's taste. If a small zone has fewer than 3 places, we ask again around its center.
- **Briefs.** The LLM writes a short brief per zone from these facts.

The pipeline streams its steps over Server-Sent Events, so zones appear on the map before profiles and briefs are ready.

**Scoring** lives in a shared package of pure functions with tests, and the browser and the server run the same code. Competition pressure is a Gaussian kernel (σ = 600 m) over competitors, each weighted `0.5 + 0.5 · affinity`, normalized by the 95th percentile. Opportunity is `affinity · (1 − competitionWeight · pressure)`, zero below a minimum taste match and inside excluded areas. Zones are DBSCAN clusters of the best cells, with the radius adapted to the grid size.

**Agent.** An LLM with tool use (Claude Sonnet 5.5 through the Anthropic API) and eight tools: `run_scout`, `update_anchors`, `adjust_scoring`, `exclude_area`, `reset_exclusions`, `profile_zone`, `compare_zones` and `explain_place`. Tools that change scoring recompute the zones with the shared scoring code and fetch Qloo profiles for the new zones, so the agent can talk about them.

**Grounding.** The LLM refers to entities only as `[[id]]` tokens, and code substitutes the names. Each reply and brief is checked: an unknown token or a capitalized name that is not in the data fails the check, the model gets one retry, then a template answer is used. If the LLM is unavailable, the chat answers simple commands from the data in a clearly labeled Basic mode.

**Stack.** TypeScript in strict mode across three npm workspaces: React and MapLibre with OpenFreeMap tiles on the front end, Node.js and Hono on the server, and one Docker container that serves both, so the Qloo key never leaves the server.

### Challenges we ran into

- **Qloo silently ignores parameters it doesn't support.** A wrong parameter returns 200 with a plausible but unfiltered result. We built an allowlist of parameters per `filter.type` into the client, and verified every parameter missing from the parameter guide by comparing responses with and without it.
- **Proving the core idea before building on it.** If the heatmap only showed where people are, the project would be pointless. With our first live key we compared heatmaps of two different concepts (Spearman 0.51) and checked that local anchors don't make the map light up only around themselves (0.97 between local and out-of-town anchors).
- **The live API differs from the docs in small ways.** The resolved locality is an array, not an object; neighborhoods are often missing; tag ids live in different fields in different endpoints. All parsing sits in one normalization module tested on synthetic fixtures.
- **No neighborhood boundaries.** The locality boundary option of the heatmap returned an error, so neighborhood names come from places, and excluding a neighborhood uses the outline of the places we know there.
- **Anchor venues don't come back** when we ask for the taste match of a list of competitors: in Austin 17 of 20 ramen places did, and the missing ones were the anchors themselves. Those competitors get full weight.
- **An LLM that names places is a liability** in a product that recommends real locations. Tokens plus a code check made invented places impossible rather than unlikely.
- **A public demo on a 10,000 requests per month key.** Responses are cached in memory and on disk, the client keeps to 4 requests per second with retries, the per-IP limit refunds analyses served entirely from cache, and if Qloo is down the server serves the last saved real response, marked as cached in the Trace panel.
- **Qloo's terms forbid storing responses in a public repository.** Tests and the offline demo run on synthetic fixtures generated by a script, with fictional places and ids.

### Accomplishments that we're proud of

- The whole city is analyzed, not one point: 1,600 to 2,700 cells scored per analysis.
- The slider recomputes zones instantly in the browser with the same code the server and the agent use.
- The agent cannot recommend a place Qloo didn't return.
- Every Qloo call is visible in the Trace panel, so anyone can check how the answer was built.
- It degrades gracefully: without the LLM it runs in Basic mode, without Qloo it serves saved real responses, and without a key it runs on clearly labeled demo data.

### What we learned

- Taste is spatial and concept-specific: the same city looks different for each concept, which is exactly what traffic and census data miss.
- With an API that silently ignores parameters, every assumption has to be checked against a live response before code depends on it.
- An agent is most trustworthy when the LLM stays at the edges: parsing the request, choosing tools and writing prose, while code produces the numbers and names.

### What's next for Whitespace

- **Rent and foot traffic** from partner data as extra layers, so taste becomes one input of a full site score.
- **Price-aware competition**: compare only with venues in your price range (`filter.price_level`).
- **What makes each zone different**: taste tags of the zone's audience, and the artists and brands it loves, for marketing ideas in the brief.
- **More cities**, inside and beyond the US.
- **An MCP server** with the same tools, so other agents can ask Whitespace where to open.
- **For brokers and franchise teams**: a paid report per location decision, priced against the cost of a site selection consultant.

## Testing instructions

- Open the demo. No login or setup is needed.
- The example concept is filled in for Austin. Press **Find spots** and watch the steps arrive; a repeat run comes from cache.
- Try the chat: "Exclude downtown", "Compare zone 1 and zone 2", "I am less worried about competition", "Tell me about zone 3".
- Move the competition slider and switch between the Audience and Opportunity layers.
- Open **How Whitespace used Qloo** under the zone cards to see every Qloo call.
- Brooklyn and Chicago are in the city list.
- "cached" next to a step in the Trace panel means a saved real Qloo response was used. A "Demo data" badge means recorded or synthetic data instead of live calls. "Basic mode" in the chat means the LLM was unavailable and the chat answered from templates.

## Built during the hackathon

The project was built during the submission period; the first commit is from October 12, 2026.

## Before submitting

- [x] Demo deployed, URL added above and in the README
- [ ] Repository public, MIT license visible in About
- [ ] Screenshots uploaded, `docs/screenshot.png` added to the repository
- [ ] Video uploaded and linked
- [ ] Both team members added to the Devpost project

### Screenshots to upload

1. Austin result: three zones on the Opportunity layer.
2. A zone card: neighborhood, places locals love, drivers and brief.
3. The chat excluding an area, with the zones moving on the map.
4. The Trace panel open.
5. The audience portrait.
6. The downloaded brief.

### Video outline (under 3 minutes)

- 0:00–0:20. The problem: traffic and demographics don't say whether people will love your concept.
- 0:20–1:20. Austin: concept, anchors, heatmap, competitors, top 3 zones, a zone card.
- 1:20–2:00. The agent: exclude downtown, compare zones 1 and 2, the slider.
- 2:00–2:30. Why only Qloo: heatmap per concept, taste-weighted competitors, explainability, the Trace panel.
- 2:30–3:00. Concept first instead of location first, who it's for, what's next.
