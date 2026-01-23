defmodule Cardtable.Game do
  @moduledoc """
  Pure game state and transition functions for a single cardtable game.

  This module is called by `Cardtable.GameServer` to mutate state, while
  `CardtableWeb.GameChannel` broadcasts the resulting views to clients.
  """

  @type card_face :: %{title: String.t() | nil, body: String.t() | nil, image: String.t() | nil}
  @type card_type :: :fish | :quirk
  @type card :: %{id: String.t(), type: card_type(), face: card_face()}

  defstruct code: nil,
            deck_set: nil,
            quirk_set: nil,
            deck_back_image: nil,
            fish_deck: [],
            quirk_deck: [],
            fish_discard: [],
            quirk_discard: [],
            table_rows: %{},
            table_faces: %{},
            players: %{},
            fish_hands: %{},
            quirk_hands: %{},
            cards: %{}

  @doc """
  Builds a new game state with shuffled fish + quirk decks.

  Fish and quirks are *independent* cards (no pairing).
  """
  def new(code, deck_set, quirk_set, fish_defs, quirk_defs, opts \\ []) do
    shuffle? = Keyword.get(opts, :shuffle, true)
    deck_back_image = Keyword.get(opts, :deck_back_image)
    quirk_defs = if quirk_set in [nil, ""], do: [], else: quirk_defs

    fish_cards = build_cards(fish_defs, :fish, "f")
    quirk_cards = build_cards(quirk_defs, :quirk, "q")

    fish_deck = fish_cards |> Enum.map(& &1.id) |> maybe_shuffle(shuffle?)
    quirk_deck = quirk_cards |> Enum.map(& &1.id) |> maybe_shuffle(shuffle?)

    %__MODULE__{
      code: code,
      deck_set: deck_set,
      quirk_set: quirk_set,
      deck_back_image: deck_back_image,
      fish_deck: fish_deck,
      quirk_deck: quirk_deck,
      fish_discard: [],
      quirk_discard: [],
      table_rows: %{},
      table_faces: %{},
      players: %{},
      fish_hands: %{},
      quirk_hands: %{},
      cards: Map.new(fish_cards ++ quirk_cards, &{&1.id, &1})
    }
  end

  @doc "Adds a player and empty fish/quirk hands to the game state."
  def add_player(game, player_id, name) do
    players = Map.put_new(game.players, player_id, %{id: player_id, name: name, connected: true})
    fish_hands = Map.put_new(game.fish_hands, player_id, [])
    quirk_hands = Map.put_new(game.quirk_hands, player_id, [])
    table_rows = Map.put_new(game.table_rows, player_id, [])
    %{game | players: players, fish_hands: fish_hands, quirk_hands: quirk_hands, table_rows: table_rows}
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

  @doc """
  Draws the top fish card into a player's hand or onto the table.

  Backwards compatible entrypoint; defaults to drawing from the fish deck.
  """
  def draw(game, player_id, to_zone) when to_zone in [:hand, :table] do
    draw(game, player_id, :fish, to_zone)
  end

  @doc "Draws the top card from a specific deck into a player's hand or onto the table."
  def draw(game, player_id, deck, to_zone) when deck in [:fish, :quirk] and to_zone in [:hand, :table] do
    {pile, key} = deck_pile(game, deck)

    case pile do
      [card_id | rest] ->
        game = Map.put(game, key, rest)

        case to_zone do
          :hand -> {:ok, put_in_hand(game, player_id, card_id)}
          :table -> {:ok, put_in_table(game, player_id, card_id)}
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

  @doc "Steals a random card (fish or quirk) from another player's hand into a target zone."
  def steal_random(game, player_id, from_player_id, to_zone) do
    fish_hand = Map.get(game.fish_hands, from_player_id, [])
    quirk_hand = Map.get(game.quirk_hands, from_player_id, [])
    hand = fish_hand ++ quirk_hand

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

  @doc """
  Flips a card that is currently on the table between face-down and face-up.

  Cards are placed on the table face-down by default.
  """
  def flip_table_card(game, card_id) do
    on_table? =
      Enum.any?(game.table_rows, fn {_pid, row} ->
        Enum.member?(row, card_id)
      end)

    if not on_table? do
      {:error, :card_not_on_table}
    else
      current = Map.get(game.table_faces, card_id, :down)
      next = if current == :down, do: :up, else: :down
      {:ok, %{game | table_faces: Map.put(game.table_faces, card_id, next)}}
    end
  end

  @doc "No-op for legacy clients; discard quirks are not a concept anymore."
  def toggle_discard_quirk(_game), do: {:error, :action_not_allowed}

  @doc "No-op for legacy clients; table is arranged in per-player rows."
  def set_table_position(_game, _card_id, _position), do: {:error, :action_not_allowed}

  @doc "Shuffles the fish discard pile into the fish deck."
  def shuffle_discard_into_deck(game) do
    if game.fish_discard == [] do
      {:error, :empty_discard}
    else
      deck = Enum.shuffle(game.fish_deck ++ game.fish_discard)
      {:ok, %{game | fish_deck: deck, fish_discard: []}}
    end
  end

  @doc "Shuffles the quirk discard pile into the quirk deck."
  def shuffle_quirk_discard_into_deck(game) do
    if game.quirk_discard == [] do
      {:error, :empty_discard}
    else
      deck = Enum.shuffle(game.quirk_deck ++ game.quirk_discard)
      {:ok, %{game | quirk_deck: deck, quirk_discard: []}}
    end
  end

  @doc "Rebuilds both decks while keeping the same player roster."
  def restart(game, deck_set, quirk_set, fish_defs, quirk_defs, deck_back_image) do
    new_game = new(game.code, deck_set, quirk_set, fish_defs, quirk_defs, deck_back_image: deck_back_image)
    player_ids = Map.keys(game.players)

    %{
      new_game
      | players: game.players,
        fish_hands: Map.new(player_ids, &{&1, []}),
        quirk_hands: Map.new(player_ids, &{&1, []}),
        table_rows: Map.new(player_ids, &{&1, []}),
        table_faces: %{}
    }
  end

  @doc "Builds the public view of the game for broadcast."
  def public_state(game, available_decks) do
    %{
      code: game.code,
      deck_set: game.deck_set,
      quirk_set: game.quirk_set,
      deck_back_image: game.deck_back_image,
      fish_deck_count: length(game.fish_deck),
      quirk_deck_count: length(game.quirk_deck),
      fish_discard_count: length(game.fish_discard),
      quirk_discard_count: length(game.quirk_discard),
      fish_discard_top: discard_top(game, :fish),
      quirk_discard_top: discard_top(game, :quirk),
      table: table_state(game),
      players: player_state(game),
      available_decks: available_decks
    }
  end

  @doc "Builds the private view of the game for a specific player."
  def private_state(game, player_id) do
    %{
      player_id: player_id,
      fish_hand: Map.get(game.fish_hands, player_id, []) |> Enum.map(&private_card(game, &1)),
      quirk_hand: Map.get(game.quirk_hands, player_id, []) |> Enum.map(&private_card(game, &1))
    }
  end

  defp private_card(game, card_id) do
    card = game.cards[card_id]
    %{card_id: card_id, type: card.type, face: card.face}
  end

  # Builds card structs with stable IDs for a given type.
  defp build_cards(defs, type, prefix) do
    defs
    |> Enum.with_index(1)
    |> Enum.map(fn {card_face, index} ->
      %{id: "#{prefix}_#{index}_#{short_id()}", type: type, face: card_face}
    end)
  end

  defp maybe_shuffle(list, true), do: Enum.shuffle(list)
  defp maybe_shuffle(list, false), do: list

  # Generates a short random ID suffix for card identifiers.
  defp short_id do
    :crypto.strong_rand_bytes(4)
    |> Base.url_encode64(padding: false)
  end

  defp deck_pile(game, :fish), do: {game.fish_deck, :fish_deck}
  defp deck_pile(game, :quirk), do: {game.quirk_deck, :quirk_deck}

  defp discard_pile(game, :fish), do: {game.fish_discard, :fish_discard}
  defp discard_pile(game, :quirk), do: {game.quirk_discard, :quirk_discard}

  # Adds a card to a player's correct hand based on card type.
  defp put_in_hand(game, player_id, card_id) do
    case game.cards[card_id] do
      %{type: :fish} ->
        hands = Map.update(game.fish_hands, player_id, [card_id], fn hand -> [card_id | hand] end)
        %{game | fish_hands: hands}

      %{type: :quirk} ->
        hands = Map.update(game.quirk_hands, player_id, [card_id], fn hand -> [card_id | hand] end)
        %{game | quirk_hands: hands}

      _ ->
        game
    end
  end

  # Adds a card to the table row of the player who played it.
  defp put_in_table(game, player_id, card_id) do
    table_rows = Map.update(game.table_rows, player_id, [card_id], fn row -> row ++ [card_id] end)
    # Cards enter the table face-down by default.
    table_faces = Map.put(game.table_faces, card_id, :down)
    %{game | table_rows: table_rows, table_faces: table_faces}
  end

  # Removes a card from a zone if present.
  defp remove_from_zone(game, player_id, card_id, :hand) do
    fish_hand = Map.get(game.fish_hands, player_id, [])
    quirk_hand = Map.get(game.quirk_hands, player_id, [])

    cond do
      Enum.member?(fish_hand, card_id) ->
        hands = Map.put(game.fish_hands, player_id, List.delete(fish_hand, card_id))
        {:ok, %{game | fish_hands: hands}}

      Enum.member?(quirk_hand, card_id) ->
        hands = Map.put(game.quirk_hands, player_id, List.delete(quirk_hand, card_id))
        {:ok, %{game | quirk_hands: hands}}

      true ->
        {:error, :card_not_in_hand}
    end
  end

  defp remove_from_zone(game, _player_id, card_id, :table) do
    {owner_id, _idx} =
      game.table_rows
      |> Enum.find_value({nil, nil}, fn {pid, row} ->
        case Enum.find_index(row, &(&1 == card_id)) do
          nil -> false
          idx -> {pid, idx}
        end
      end)

    if is_nil(owner_id) do
      {:error, :card_not_on_table}
    else
      row = Map.get(game.table_rows, owner_id, [])
      table_rows = Map.put(game.table_rows, owner_id, List.delete(row, card_id))
      table_faces = Map.delete(game.table_faces, card_id)
      {:ok, %{game | table_rows: table_rows, table_faces: table_faces}}
    end
  end

  defp remove_from_zone(game, _player_id, card_id, :discard) do
    case game.cards[card_id] do
      %{type: type} ->
        {pile, key} = discard_pile(game, type)

        if Enum.member?(pile, card_id) do
          {:ok, Map.put(game, key, List.delete(pile, card_id))}
        else
          {:error, :card_not_in_discard}
        end

      _ ->
        {:error, :card_not_found}
    end
  end

  defp remove_from_zone(game, _player_id, card_id, :deck) do
    case game.cards[card_id] do
      %{type: type} ->
        {pile, key} = deck_pile(game, type)

        if Enum.member?(pile, card_id) do
          {:ok, Map.put(game, key, List.delete(pile, card_id))}
        else
          {:error, :card_not_in_deck}
        end

      _ ->
        {:error, :card_not_found}
    end
  end

  defp remove_from_zone(_game, _player_id, _card_id, _zone), do: {:error, :action_not_allowed}

  # Adds a card to a zone, optionally targeting another player.
  defp add_to_zone(game, player_id, card_id, :hand, target_player_id) do
    target = target_player_id || player_id
    {:ok, put_in_hand(game, target, card_id)}
  end

  defp add_to_zone(game, player_id, card_id, :table, _target_player_id) do
    {:ok, put_in_table(game, player_id, card_id)}
  end

  defp add_to_zone(game, _player_id, card_id, :discard, _target_player_id) do
    case game.cards[card_id] do
      %{type: type} ->
        {pile, key} = discard_pile(game, type)
        {:ok, Map.put(game, key, [card_id | pile])}

      _ ->
        {:error, :card_not_found}
    end
  end

  defp add_to_zone(game, _player_id, card_id, :deck, _target_player_id) do
    case game.cards[card_id] do
      %{type: type} ->
        {pile, key} = deck_pile(game, type)
        {:ok, Map.put(game, key, [card_id | pile])}

      _ ->
        {:error, :card_not_found}
    end
  end

  defp add_to_zone(_game, _player_id, _card_id, _to_zone, _target_player_id), do: {:error, :action_not_allowed}

  defp discard_top(game, type) when type in [:fish, :quirk] do
    {pile, _key} = discard_pile(game, type)

    case pile do
      [card_id | _] ->
        card = game.cards[card_id]
        %{card_id: card_id, type: card.type, face: card.face}

      [] ->
        nil
    end
  end

  defp table_state(game) do
    # Stable per-player rows, ordered by player name.
    player_ids =
      game.players
      |> Map.values()
      |> Enum.sort_by(& &1.name)
      |> Enum.map(& &1.id)

    Enum.map(player_ids, fn player_id ->
      cards =
        game.table_rows
        |> Map.get(player_id, [])
        |> Enum.map(fn card_id ->
          card = game.cards[card_id]
          face_state = Map.get(game.table_faces, card_id, :down)

          %{
            card_id: card_id,
            type: card.type,
            face_state: Atom.to_string(face_state),
            # Hide face contents when face-down.
            face: if(face_state == :down, do: nil, else: card.face),
            played_by: player_id
          }
        end)

      %{player_id: player_id, cards: cards}
    end)
  end

  defp player_state(game) do
    game.players
    |> Map.values()
    |> Enum.map(fn player ->
      fish_count = length(Map.get(game.fish_hands, player.id, []))
      quirk_count = length(Map.get(game.quirk_hands, player.id, []))
      %{id: player.id, name: player.name, fish_hand_count: fish_count, quirk_hand_count: quirk_count, connected: player.connected}
    end)
    |> Enum.sort_by(& &1.name)
  end
end
