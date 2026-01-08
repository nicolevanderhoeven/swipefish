defmodule Cardtable.Game do
  @moduledoc """
  Pure game state and transition functions for a single cardtable game.

  This module is called by `Cardtable.GameServer` to mutate state, while
  `CardtableWeb.GameChannel` broadcasts the resulting views to clients.
  """

  @type card_face :: %{title: String.t() | nil, body: String.t() | nil, image: String.t() | nil}

  defstruct code: nil,
            deck_set: nil,
            quirk_set: nil,
            quirks_enabled: false,
            deck_back_image: nil,
            deck: [],
            discard: [],
            discard_quirk_revealed: false,
            table: %{cards: [], states: %{}, positions: %{}},
            players: %{},
            hands: %{},
            cards: %{}

  @doc "Builds a new game state with a shuffled deck and paired quirks."
  def new(code, deck_set, quirk_set, card_defs, quirk_defs, opts \\ []) do
    shuffle? = Keyword.get(opts, :shuffle, true)
    deck_back_image = Keyword.get(opts, :deck_back_image)
    quirks_enabled = quirk_set not in [nil, ""] and length(quirk_defs) > 0

    cards = build_cards(card_defs, quirk_defs, quirks_enabled)
    deck_ids = Enum.map(cards, & &1.id)
    deck = if shuffle?, do: Enum.shuffle(deck_ids), else: deck_ids

    %__MODULE__{
      code: code,
      deck_set: deck_set,
      quirk_set: quirk_set,
      quirks_enabled: quirks_enabled,
      deck_back_image: deck_back_image,
      deck: deck,
      cards: Map.new(cards, &{&1.id, &1})
    }
  end

  @doc "Adds a player and an empty hand to the game state."
  def add_player(game, player_id, name) do
    players = Map.put_new(game.players, player_id, %{id: player_id, name: name, connected: true})
    hands = Map.put_new(game.hands, player_id, [])
    %{game | players: players, hands: hands}
  end

  @doc "Updates a player's connected status for presence tracking."
  def mark_connected(game, player_id, connected) do
    players =
      Map.update(game.players, player_id, %{id: player_id, name: "Player", connected: connected}, fn player ->
        %{player | connected: connected}
      end)

    %{game | players: players}
  end

  @doc "Updates a player's display name in the game state."
  def update_player_name(game, player_id, name) do
    players =
      Map.update(game.players, player_id, %{id: player_id, name: name, connected: true}, fn player ->
        %{player | name: name}
      end)

    %{game | players: players}
  end

  @doc "Draws the top card into a player's hand or onto the table."
  def draw(game, player_id, to_zone) when to_zone in [:hand, :table] do
    case game.deck do
      [card_id | rest] ->
        game = %{game | deck: rest}

        case to_zone do
          :hand ->
            {:ok, put_in_hand(game, player_id, card_id)}

          :table ->
            {:ok, put_in_table(game, card_id)}
        end

      [] ->
        {:error, :empty_deck}
    end
  end

  @doc "Moves a card between zones, optionally targeting another player's hand."
  def move_card(game, player_id, card_id, from_zone, to_zone, target_player_id) do
    with {:ok, game} <- remove_from_zone(game, player_id, card_id, from_zone),
         {:ok, game} <- add_to_zone(game, player_id, card_id, to_zone, target_player_id) do
      {:ok, game}
    end
  end

  @doc "Steals a random card from another player's hand into a target zone."
  def steal_random(game, player_id, from_player_id, to_zone) do
    hand = Map.get(game.hands, from_player_id, [])

    case hand do
      [] ->
        {:error, :empty_hand}

      _ ->
        card_id = Enum.at(hand, :rand.uniform(length(hand)) - 1)
        {:ok, game} = remove_from_zone(game, from_player_id, card_id, :hand)
        {:ok, game} = add_to_zone(game, player_id, card_id, to_zone, player_id)
        {:ok, game}
    end
  end

  @doc "Updates a card's table position for free-form layouts."
  def set_table_position(game, card_id, position) do
    if Enum.member?(game.table.cards, card_id) do
      table = put_in(game.table, [:positions, card_id], position)
      {:ok, %{game | table: table}}
    else
      {:error, :card_not_on_table}
    end
  end

  @doc "Cycles a table card through face states (down/up/quirk)."
  def flip_table_card(game, card_id) do
    if Enum.member?(game.table.cards, card_id) do
      current = Map.get(game.table.states, card_id, :down)
      next = next_face_state(current)
      table = put_in(game.table, [:states, card_id], next)
      {:ok, %{game | table: table}}
    else
      {:error, :card_not_on_table}
    end
  end

  @doc "Toggles the quirk visibility for the top discard card."
  def toggle_discard_quirk(game) do
    if game.discard == [] do
      {:error, :empty_discard}
    else
      {:ok, %{game | discard_quirk_revealed: !game.discard_quirk_revealed}}
    end
  end

  @doc "Shuffles the discard pile into a new deck."
  def shuffle_discard_into_deck(game) do
    if game.discard == [] do
      {:error, :empty_discard}
    else
      deck = Enum.shuffle(game.discard)
      {:ok, %{game | deck: deck, discard: [], discard_quirk_revealed: false}}
    end
  end

  @doc "Rebuilds the deck while keeping the same player roster."
  def restart(game, deck_set, quirk_set, card_defs, quirk_defs, deck_back_image) do
    new_game =
      new(game.code, deck_set, quirk_set, card_defs, quirk_defs,
        deck_back_image: deck_back_image
      )

    %{new_game | players: game.players, hands: Map.new(game.players, fn {id, _} -> {id, []} end)}
  end

  @doc "Builds the public view of the game for broadcast."
  def public_state(game, available_decks) do
    %{
      code: game.code,
      deck_set: game.deck_set,
      quirk_set: game.quirk_set,
      deck_back_image: game.deck_back_image,
      deck_count: length(game.deck),
      discard_top: discard_top(game),
      table: table_state(game),
      players: player_state(game),
      available_decks: available_decks
    }
  end

  @doc "Builds the private view of the game for a specific player."
  def private_state(game, player_id) do
    %{
      player_id: player_id,
      hand:
        game.hands
        |> Map.get(player_id, [])
        |> Enum.map(fn card_id ->
          card = game.cards[card_id]
          %{card_id: card_id, face: card.face, quirk: if(game.quirks_enabled, do: card.quirk, else: nil)}
        end)
    }
  end

  # Pairs card definitions with quirks and assigns stable IDs.
  defp build_cards(card_defs, quirk_defs, quirks_enabled) do
    quirks =
      if quirks_enabled and length(quirk_defs) > 0 do
        quirk_defs
        |> Enum.shuffle()
        |> Stream.cycle()
      else
        Stream.cycle([nil])
      end

    card_defs
    |> Enum.with_index(1)
    |> Enum.zip(quirks)
    |> Enum.map(fn {{card, index}, quirk} ->
      %{id: "c_#{index}_#{short_id()}", face: card, quirk: quirk}
    end)
  end

  # Generates a short random ID suffix for card identifiers.
  defp short_id do
    :crypto.strong_rand_bytes(4)
    |> Base.url_encode64(padding: false)
  end

  # Returns the next face state in the table cycle.
  defp next_face_state(:down), do: :up
  defp next_face_state(:up), do: :quirk
  defp next_face_state(:quirk), do: :down

  # Adds a card to a player's hand.
  defp put_in_hand(game, player_id, card_id) do
    hands = Map.update(game.hands, player_id, [card_id], fn hand -> [card_id | hand] end)
    %{game | hands: hands}
  end

  # Adds a card to the table in a face-down state.
  defp put_in_table(game, card_id) do
    table =
      game.table
      |> update_in([:cards], fn cards -> [card_id | cards] end)
      |> put_in([:states, card_id], :down)
      |> put_in([:positions, card_id], %{x: 0.5, y: 0.5})

    %{game | table: table}
  end

  # Removes a card from a zone if present.
  defp remove_from_zone(game, player_id, card_id, :hand) do
    hand = Map.get(game.hands, player_id, [])

    if Enum.member?(hand, card_id) do
      hands = Map.put(game.hands, player_id, List.delete(hand, card_id))
      {:ok, %{game | hands: hands}}
    else
      {:error, :card_not_in_hand}
    end
  end

  defp remove_from_zone(game, _player_id, card_id, :table) do
    if Enum.member?(game.table.cards, card_id) do
      table =
        game.table
        |> update_in([:cards], fn cards -> List.delete(cards, card_id) end)
        |> update_in([:states], &Map.delete(&1, card_id))
        |> update_in([:positions], &Map.delete(&1, card_id))

      {:ok, %{game | table: table}}
    else
      {:error, :card_not_on_table}
    end
  end

  defp remove_from_zone(game, _player_id, card_id, :discard) do
    if Enum.member?(game.discard, card_id) do
      {:ok, %{game | discard: List.delete(game.discard, card_id)}}
    else
      {:error, :card_not_in_discard}
    end
  end

  defp remove_from_zone(game, _player_id, card_id, :deck) do
    if Enum.member?(game.deck, card_id) do
      {:ok, %{game | deck: List.delete(game.deck, card_id)}}
    else
      {:error, :card_not_in_deck}
    end
  end

  # Adds a card to a zone, optionally targeting another player.
  defp add_to_zone(game, player_id, card_id, :hand, target_player_id) do
    target = target_player_id || player_id
    {:ok, put_in_hand(game, target, card_id)}
  end

  defp add_to_zone(game, _player_id, card_id, :table, _target_player_id) do
    {:ok, put_in_table(game, card_id)}
  end

  defp add_to_zone(game, _player_id, card_id, :discard, _target_player_id) do
    {:ok, %{game | discard: [card_id | game.discard], discard_quirk_revealed: false}}
  end

  defp add_to_zone(game, _player_id, card_id, :deck, _target_player_id) do
    {:ok, %{game | deck: [card_id | game.deck]}}
  end

  # Builds the discard top card payload for the public view.
  defp discard_top(game) do
    case game.discard do
      [card_id | _] ->
        card = game.cards[card_id]
        %{
          card_id: card_id,
          face: card.face,
          quirk: if(game.discard_quirk_revealed and game.quirks_enabled, do: card.quirk, else: nil),
          quirk_revealed: game.discard_quirk_revealed
        }

      [] ->
        nil
    end
  end

  # Builds the table card payloads for the public view.
  defp table_state(game) do
    states = Map.get(game.table, :states, %{})
    positions = Map.get(game.table, :positions, %{})

    Enum.map(game.table.cards, fn card_id ->
      card = game.cards[card_id]
      face_state = Map.get(states, card_id, :down)
      %{
        card_id: card_id,
        face_state: face_state,
        position: Map.get(positions, card_id),
        face: if(face_state == :down, do: nil, else: card.face),
        quirk: if(face_state == :quirk and game.quirks_enabled, do: card.quirk, else: nil)
      }
    end)
  end

  # Builds the player list summary for the public view.
  defp player_state(game) do
    game.players
    |> Map.values()
    |> Enum.map(fn player ->
      %{id: player.id, name: player.name, hand_count: length(Map.get(game.hands, player.id, [])), connected: player.connected}
    end)
    |> Enum.sort_by(& &1.name)
  end
end
