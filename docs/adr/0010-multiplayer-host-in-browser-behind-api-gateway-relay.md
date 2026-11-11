# Multiplayer runs the game in the host's browser, and guests reach it through an API Gateway WebSocket relay

Players want to play each other, not only the AI. Stage 1 of multiplayer is live play among friends: 2–4 humans online together, joined by an invite link, with AI players in the European seats nobody picked and no accounts. Turns are FreeCol's own sequential turns. It comes after 1.0, and single-player does not change.

The host's browser runs the server Engine, AI included, in its Worker as it does today. Each guest runs only the client Engine. FreeCol's `Server` already takes several connections, so `ServerEngine` gains one `PostMessageConnection` per seat in place of its single human. Messages between host and guests pass through a **Multiplayer relay**: an API Gateway WebSocket API in the `browsercol` AWS account (us-east-1), whose `$connect`, `$disconnect` and `$default` routes call one Lambda, with a DynamoDB table mapping each Room to its host and Seat connections. The relay reads only the addressing (`to`/`from` a Seat) and never the FreeCol XML. It does not change with game releases.

The relay costs nothing while nobody plays, which suits a hobby project that may see very little multiplayer. The price is paid in the Browser UI. API Gateway can deliver two messages from one socket out of order, since it runs Lambdas in parallel. It caps a message at 128 KB, while a guest's first game state is several MB. It closes a socket after 10 minutes idle and after 2 hours in any case. So `ui/src/channel.ts` gets one layer that host and guest both run, holding these rules:

- Each direction has **one batch in flight**, numbered. The receiver acknowledges it, and only then is the next batch sent; whatever FreeCol produces meanwhile goes in the next batch. Order needs no reordering buffer, and after a reconnect the sender resends the unacknowledged batch.
- A batch over 128 KB is split into parts and put back together on arrival.
- A keepalive ping stops the 10-minute close. Before the 2-hour close, the browser opens a new socket for its Seat and switches to it, so the forced close never lands mid-game.

The host can cheat, since their browser holds the whole game. Stage 1 accepts that: it is for friends. Each guest still receives only its own player's view, as FreeCol's server filters what it sends.

## Considered Options

- **A small box (Lightsail or a t4g.nano) running a Node `ws` relay:** rejected for stage 1. Order comes free over one TCP connection, there is no message cap and no forced close, so the browser layer above would be smaller. But it costs about $5–7 a month while idle, and a forgotten VM is a patching liability. It is still the natural home for server-hosted games later.
- **A Cloudflare Durable Object per Room:** rejected. It keeps order, allows 32 MiB messages and costs nothing idle with WebSocket hibernation, so it would need less browser code than API Gateway. It brings a second provider and account beside AWS; the owner chose to stay in AWS.
- **Server-hosted games (`server.wasm` under Node on a box, as `engine/run-split-node.mjs` already runs it):** deferred to a later stage. It stops the host cheating, keeps a game alive when the host leaves, and is the ground for asynchronous play. It needs a box that holds a game's memory per game, which stage 1 does not want to pay for.
- **WebRTC between browsers:** rejected. It still needs a server to introduce peers, and a TURN relay for the networks where a direct connection fails.
- **Relying on FreeCol's own reconnect instead of the batch layer:** rejected for API Gateway. Every forced close would resend the whole game state, a few seconds behind a "Reconnecting…" overlay, at least every 2 hours for each player.

## Consequences

- Multiplayer needs the relay; single-player never touches it, so ADR 0001's rule (the game must run with no third-party runtime) still holds for the game itself, as with the feedback relay (ADR 0009). The two relays are separate SAM stacks.
- The relay's guards cost money, not features. `$connect` accepts only the `https://browsercol.com` Origin. The API stage is throttled. The Lambda's reserved concurrency is capped. Rooms expire in DynamoDB 24 hours after their last activity. An AWS Budget alerts at $5 a month. A Room's ID is long and random; knowing it is what lets a player in.
- The deploy is by hand, the SAM CLI from Docker against the `browsercol` profile, and the script refuses any other account. The relay's address is API Gateway's own `execute-api` URL, baked into the build; a custom domain can come later.
- SAM cannot run WebSocket APIs locally. A fake relay in Node acts as API Gateway does (reorders, caps at 128 KB, closes sockets, drops what is in flight across a reconnect). The batch layer's unit tests and an `mp` browser script that plays two players run against it. The real relay is checked by hand after each deploy.
- A Room survives the host closing the tab only as a save. The host's browser autosaves every turn; "Host again" from that save reopens the same Room, so the old link and each guest's Seat token still work.
- A guest whose build differs from the host's is told to reload before joining.
- Diplomacy and trade between humans keep FreeCol's 60-second answer time in multiplayer; single-player keeps its effectively unlimited one.
