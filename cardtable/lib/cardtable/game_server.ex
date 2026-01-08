defmodule Cardtable.GameServer do
  @moduledoc """
  GenServer that owns one game instance and applies state transitions.

  The channel layer calls this module for all game actions and then broadcasts
  the updated public/private views.
  """

  use GenServer

  alias Cardtable.Decks
  alias Cardtable.Game

  @doc "Starts a game server process for a specific game code."
  def start_link(code) do
    GenServer.start_link(__MODULE__, code, name: via(code))
  end

  @doc "Joins or reattaches a player to a game, returning IDs and state."
  def join(code, player_name, player_token) do
    GenServer.call(via(code), {:join, normalize_name(player_name), player_token})
  end

  @doc "Returns the current game state for a given player."
  def sync(code, player_id) do
    GenServer.call(via(code), {:sync, player_id})
  end

  @doc "Draws a card into the player's hand or onto the table."
  def draw(code, player_id, to_zone) do
    GenServer.call(via(code), {:draw, player_id, to_zone})
  end

  @doc "Moves a card between zones, optionally targeting another player."
  def move_card(code, player_id, card_id, from_zone, to_zone, target_player_id) do
    GenServer.call(via(code), {:move_card, player_id, card_id, from_zone, to_zone, target_player_id})
  end

  @doc "Steals a random card from another player into a target zone."
  def steal_random(code, player_id, from_player_id, to_zone) do
    GenServer.call(via(code), {:steal_random, player_id, from_player_id, to_zone})
  end

  @doc "Updates a card's free-form position on the table."
  def set_table_position(code, card_id, position) do
    GenServer.call(via(code), {:set_table_position, card_id, position})
  end

  @doc "Cycles a table card's face state."
  def flip_table_card(code, card_id) do
    GenServer.call(via(code), {:flip_table_card, card_id})
  end

  @doc "Toggles quirk visibility for the top discard card."
  def toggle_discard_quirk(code) do
    GenServer.call(via(code), :toggle_discard_quirk)
  end

  @doc "Shuffles the discard pile into a fresh deck."
  def shuffle_discard_into_deck(code) do
    GenServer.call(via(code), :shuffle_discard_into_deck)
  end

  @doc "Rebuilds the deck while keeping the current player roster."
  def restart(code, deck_set, quirk_set) do
    GenServer.call(via(code), {:restart, deck_set, quirk_set})
  end

  @doc "Marks a player as disconnected without removing them."
  def leave(code, player_id) do
    GenServer.call(via(code), {:leave, player_id})
  end

  @doc "Updates a player's display name."
  def update_player_name(code, player_id, name) do
    GenServer.call(via(code), {:update_player_name, player_id, name})
  end

  @doc "Ensures a game server exists for a game code."
  def ensure_started(code) do
    case Registry.lookup(Cardtable.GameRegistry, code) do
      [] ->
        spec = {__MODULE__, code}
        DynamicSupervisor.start_child(Cardtable.GameSupervisor, spec)
      _ ->
        {:ok, :already_started}
    end
  end

  @doc "Returns the Registry via tuple for a game server."
  def via(code), do: {:via, Registry, {Cardtable.GameRegistry, code}}

  @impl true
  @doc "Initializes a new game process with default deck settings."
  def init(code) do
    {:ok, game_state(code)}
  end

  @impl true
  @doc "Handles synchronous game actions dispatched by the channel."
  def handle_call({:join, player_name, player_token}, _from, state) do
    {player_id, token, game, increment?} =
      if player_token && player_token != "" && Map.has_key?(state.player_tokens, player_token) do
        id = state.player_tokens[player_token]
        name = player_name || state.game.players[id].name
        game = state.game |> Game.update_player_name(id, name) |> Game.mark_connected(id, true)
        {id, player_token, game, false}
      else
        new_id = "p_#{state.next_player_id}"
        name = player_name || "Player #{state.next_player_id}"
        token = new_player_token()
        game = state.game |> Game.add_player(new_id, name) |> Game.mark_connected(new_id, true)
        {new_id, token, game, true}
      end

    player_tokens = Map.put(state.player_tokens, token, player_id)
    next_player_id =
      if increment? do
        state.next_player_id + 1
      else
        state.next_player_id
      end

    state = %{state | game: game, player_tokens: player_tokens, next_player_id: next_player_id}

    {:reply, {:ok, player_id, token, state}, state}
  end

  def handle_call({:sync, player_id}, _from, state) do
    {:reply, {:ok, state.game, player_id, state.available_decks}, state}
  end

  def handle_call({:draw, player_id, to_zone}, _from, state) do
    case Game.draw(state.game, player_id, to_zone) do
      {:ok, game} ->
        {:reply, {:ok, game, player_id, state.available_decks}, %{state | game: game}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:move_card, player_id, card_id, from_zone, to_zone, target_player_id}, _from, state) do
    case Game.move_card(state.game, player_id, card_id, from_zone, to_zone, target_player_id) do
      {:ok, game} ->
        {:reply, {:ok, game, player_id, state.available_decks}, %{state | game: game}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:steal_random, player_id, from_player_id, to_zone}, _from, state) do
    case Game.steal_random(state.game, player_id, from_player_id, to_zone) do
      {:ok, game} ->
        {:reply, {:ok, game, player_id, state.available_decks}, %{state | game: game}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:set_table_position, card_id, position}, _from, state) do
    case Game.set_table_position(state.game, card_id, position) do
      {:ok, game} ->
        {:reply, {:ok, game, nil, state.available_decks}, %{state | game: game}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:flip_table_card, card_id}, _from, state) do
    case Game.flip_table_card(state.game, card_id) do
      {:ok, game} ->
        {:reply, {:ok, game, nil, state.available_decks}, %{state | game: game}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call(:toggle_discard_quirk, _from, state) do
    case Game.toggle_discard_quirk(state.game) do
      {:ok, game} ->
        {:reply, {:ok, game, nil, state.available_decks}, %{state | game: game}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call(:shuffle_discard_into_deck, _from, state) do
    case Game.shuffle_discard_into_deck(state.game) do
      {:ok, game} ->
        {:reply, {:ok, game, nil, state.available_decks}, %{state | game: game}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:restart, deck_set, quirk_set}, _from, state) do
    with {:ok, card_deck} <- Decks.load_deck(:cards, deck_set),
         {:ok, quirk_defs} <- load_quirks(quirk_set) do
      game =
        Game.restart(state.game, deck_set, quirk_set, card_deck.cards, quirk_defs, card_deck.back_image)

      {:reply, {:ok, game, nil, state.available_decks}, %{state | game: game}}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:leave, player_id}, _from, state) do
    game = Game.mark_connected(state.game, player_id, false)
    {:reply, {:ok, game, nil, state.available_decks}, %{state | game: game}}
  end

  def handle_call({:update_player_name, player_id, name}, _from, state) do
    case normalize_name(name) do
      nil ->
        {:reply, {:error, :invalid_name}, state}

      trimmed ->
        game = Game.update_player_name(state.game, player_id, trimmed)
        {:reply, {:ok, game, player_id, state.available_decks}, %{state | game: game}}
    end
  end

  # Builds the initial game state for a newly started server.
  defp game_state(code) do
    deck_set = "swipefish"
    quirk_set = "swipefish-quirks"
    {:ok, card_deck} = Decks.load_deck(:cards, deck_set)
    {:ok, quirk_defs} = load_quirks(quirk_set)

    %{
      game: Game.new(code, deck_set, quirk_set, card_deck.cards, quirk_defs, shuffle: true, deck_back_image: card_deck.back_image),
      player_tokens: %{},
      next_player_id: 1,
      available_decks: %{
        cards: Enum.map(Decks.list_decks(:cards), &%{name: &1}),
        quirks: Enum.map(Decks.list_decks(:quirks), &%{name: &1})
      }
    }
  end

  # Loads quirks if enabled, otherwise returns an empty list.
  defp load_quirks(nil), do: {:ok, []}

  defp load_quirks(""), do: {:ok, []}

  defp load_quirks(quirk_set) do
    with {:ok, deck} <- Decks.load_deck(:quirks, quirk_set) do
      {:ok, deck.cards}
    end
  end

  # Generates a random token used for player rejoin.
  defp new_player_token do
    :crypto.strong_rand_bytes(16)
    |> Base.url_encode64(padding: false)
  end

  # Normalizes player names by trimming or returning nil.
  defp normalize_name(nil), do: nil
  defp normalize_name(""), do: nil
  defp normalize_name(name), do: String.trim(name)

end
