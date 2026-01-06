Card Sandbox Spec v0.1

Core concept
- Real-time multiplayer card table with private hands and shared zones.
- No turns or restrictions; unlimited players.
- Decks defined by JSON (card deck + optional quirk deck).
- Quirks are optional; a game can be started with cards only.
- Standard 52-card play is supported via a built-in standard-52 deck with art.
- When quirks are used, each card is permanently paired with a random quirk at game start.

Zones
- Deck: hidden, count only.
- Table: shared, shows face-down/face-up/quirk states.
- Discard: shared, top card face visible; quirk visible on click.
- Hands: private; only owner sees face + quirk.

Visibility rules
- Hand: face + quirk visible only to owner.
- Table: card starts face down. Click cycles: face down -> face up -> quirk revealed -> face down.
- Discard: top card face visible to all; quirk visible on click.
- Everyone sees the same table/discard state in real time.

Moves
- Any player can move cards between any zones at any time.
- Taking from another player’s hand steals a random card from that hand.
- Deck: click to draw top card into your hand; drag from deck to table to play a face-down card.
- Discard: any player can take the top card into hand or to table.

Deck lifecycle
- On game start/restart: shuffle cards and (if quirks are enabled) pair each with a random quirk; pairing persists for the entire game.
- Decks are selected via dropdowns next to the draw deck.
- When deck is empty: no draws allowed.
- Shuffle Discard into Deck is always available to any player.

Session flow
- Lobby: create or join a game (code).
- Reloading the page does not leave the game.
- Any player can restart the game; players stay in the same game.
- Multiple tabs join as new players.

Card definition
- Cards use title, body, and image fields.
- All fields are optional, but at least one must be present.
- Cards are assumed to use standard playing card aspect ratio.

Deck storage
- Card decks: static/decks/cards/<deck>/deck.json
- Quirk decks: static/decks/quirks/<deck>/deck.json
- Deck images: static/decks/<type>/<deck>/img/
