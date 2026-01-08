defmodule CardtableWeb.GameChannel do
  @moduledoc """
  Channel that bridges websocket intents to the game server.

  This module validates inputs lightly, delegates to `Cardtable.GameServer`,
  and broadcasts public/private updates back to clients.
  """

  use Phoenix.Channel

  alias Cardtable.Game
  alias Cardtable.GameServer

  @impl true
  @doc "Joins a game topic and seeds the client with initial state."
  def join("game:" <> code, payload, socket) do
    with {:ok, _} <- GameServer.ensure_started(code),
         {:ok, player_id, player_token, state} <- GameServer.join(code, payload["player_name"], payload["player_token"]) do
      socket = assign(socket, :game_code, code)
      socket = assign(socket, :player_id, player_id)

      public_state = Game.public_state(state.game, state.available_decks)
      private_state = Game.private_state(state.game, player_id)

      reply = %{ok: true, player_id: player_id, player_token: player_token}

      send(self(), {:after_join, public_state, private_state})

      {:ok, reply, socket}
    else
      _ -> {:error, %{ok: false, error: "Failed to join game"}}
    end
  end

  @impl true
  @doc "Pushes initial payloads after join."
  def handle_info({:after_join, public_state, private_state}, socket) do
    broadcast!(socket, "game:public_update", %{public_state: public_state})
    push(socket, "game:private_update", %{private_state: private_state})
    {:noreply, socket}
  end

  @impl true
  @doc "Handles incoming client events and forwards them to the game server."
  def handle_in("game:sync", _payload, socket) do
    %{game: game, player_id: player_id, available_decks: _available_decks} = sync_state(socket)
    private_state = Game.private_state(game, player_id)
    push(socket, "game:private_update", %{private_state: private_state})
    {:noreply, socket}
  end

  def handle_in("game:draw", %{"to_zone" => to_zone}, socket) do
    with {:ok, game, player_id, available_decks} <- call_game(socket, {:draw, to_zone}) do
      broadcast_update(socket, game, available_decks)
      push_private(socket, game, player_id)
      {:noreply, socket}
    else
      {:error, reason} -> reply_error(socket, reason)
    end
  end

  def handle_in("game:move_card", payload, socket) do
    with {:ok, game, player_id, available_decks} <-
           call_game(socket, {:move_card, payload["card_id"], payload["from_zone"], payload["to_zone"], payload["target_player_id"]}) do
      broadcast_update(socket, game, available_decks)
      push_private(socket, game, player_id)
      {:noreply, socket}
    else
      {:error, reason} -> reply_error(socket, reason)
    end
  end

  def handle_in("game:steal_random", %{"from_player_id" => from_player_id, "to_zone" => to_zone}, socket) do
    with {:ok, game, player_id, available_decks} <- call_game(socket, {:steal_random, from_player_id, to_zone}) do
      broadcast_update(socket, game, available_decks)
      push_private(socket, game, player_id)
      {:noreply, socket}
    else
      {:error, reason} -> reply_error(socket, reason)
    end
  end

  def handle_in("game:set_table_position", %{"card_id" => card_id, "position" => position}, socket) do
    with {:ok, game, _player_id, available_decks} <- call_game(socket, {:set_table_position, card_id, position}) do
      broadcast_update(socket, game, available_decks)
      {:noreply, socket}
    else
      {:error, reason} -> reply_error(socket, reason)
    end
  end

  def handle_in("game:flip_table_card", %{"card_id" => card_id}, socket) do
    with {:ok, game, _player_id, available_decks} <- call_game(socket, {:flip_table_card, card_id}) do
      broadcast_update(socket, game, available_decks)
      {:noreply, socket}
    else
      {:error, reason} -> reply_error(socket, reason)
    end
  end

  def handle_in("game:toggle_discard_quirk", _payload, socket) do
    with {:ok, game, _player_id, available_decks} <- call_game(socket, :toggle_discard_quirk) do
      broadcast_update(socket, game, available_decks)
      {:noreply, socket}
    else
      {:error, reason} -> reply_error(socket, reason)
    end
  end

  def handle_in("game:shuffle_discard_into_deck", _payload, socket) do
    with {:ok, game, _player_id, available_decks} <- call_game(socket, :shuffle_discard_into_deck) do
      broadcast_update(socket, game, available_decks)
      {:noreply, socket}
    else
      {:error, reason} -> reply_error(socket, reason)
    end
  end

  def handle_in("game:restart", payload, socket) do
    with {:ok, game, _player_id, available_decks} <-
           call_game(socket, {:restart, payload["deck_set"], payload["quirk_set"]}) do
      broadcast_update(socket, game, available_decks)
      {:noreply, socket}
    else
      {:error, reason} -> reply_error(socket, reason)
    end
  end

  def handle_in("game:update_name", %{"name" => name}, socket) do
    with {:ok, game, player_id, available_decks} <- call_game(socket, {:update_player_name, name}) do
      broadcast_update(socket, game, available_decks)
      push_private(socket, game, player_id)
      {:noreply, socket}
    else
      {:error, reason} -> reply_error(socket, reason)
    end
  end

  @impl true
  @doc "Marks the player as disconnected when the socket terminates."
  def terminate(_reason, socket) do
    if socket.assigns[:game_code] && socket.assigns[:player_id] do
      _ = GameServer.leave(socket.assigns.game_code, socket.assigns.player_id)
    end

    :ok
  end

  # Dispatches a draw request to the game server.
  defp call_game(socket, {:draw, to_zone}) do
    GameServer.draw(socket.assigns.game_code, socket.assigns.player_id, to_atom_zone(to_zone))
  end

  # Dispatches a move-card request to the game server.
  defp call_game(socket, {:move_card, card_id, from_zone, to_zone, target_player_id}) do
    GameServer.move_card(
      socket.assigns.game_code,
      socket.assigns.player_id,
      card_id,
      to_atom_zone(from_zone),
      to_atom_zone(to_zone),
      target_player_id
    )
  end

  # Dispatches a steal request to the game server.
  defp call_game(socket, {:steal_random, from_player_id, to_zone}) do
    GameServer.steal_random(socket.assigns.game_code, socket.assigns.player_id, from_player_id, to_atom_zone(to_zone))
  end

  # Dispatches a table-position update to the game server.
  defp call_game(socket, {:set_table_position, card_id, position}) do
    GameServer.set_table_position(socket.assigns.game_code, card_id, position)
  end

  # Dispatches a table flip request to the game server.
  defp call_game(socket, {:flip_table_card, card_id}) do
    GameServer.flip_table_card(socket.assigns.game_code, card_id)
  end

  # Dispatches a discard quirk toggle to the game server.
  defp call_game(socket, :toggle_discard_quirk) do
    GameServer.toggle_discard_quirk(socket.assigns.game_code)
  end

  # Dispatches a discard shuffle request to the game server.
  defp call_game(socket, :shuffle_discard_into_deck) do
    GameServer.shuffle_discard_into_deck(socket.assigns.game_code)
  end

  # Dispatches a deck restart request to the game server.
  defp call_game(socket, {:restart, deck_set, quirk_set}) do
    GameServer.restart(socket.assigns.game_code, deck_set, quirk_set)
  end

  # Dispatches a player-name update request to the game server.
  defp call_game(socket, {:update_player_name, name}) do
    GameServer.update_player_name(socket.assigns.game_code, socket.assigns.player_id, name)
  end

  # Broadcasts the latest public game state to all subscribers.
  defp broadcast_update(socket, game, available_decks) do
    public_state = Game.public_state(game, available_decks)
    broadcast!(socket, "game:public_update", %{public_state: public_state})
  end

  # Pushes a private view update to the current player.
  defp push_private(socket, game, player_id) do
    private_state = Game.private_state(game, player_id)
    push(socket, "game:private_update", %{private_state: private_state})
  end

  # Pushes a formatted error to the client.
  defp reply_error(socket, reason) do
    push(socket, "game:error", %{message: format_error(reason)})
    {:noreply, socket}
  end

  # Formats domain errors into client-friendly strings.
  defp format_error(:empty_deck), do: "Deck is empty"
  defp format_error(:empty_discard), do: "Discard pile is empty"
  defp format_error(:empty_hand), do: "That player has no cards"
  defp format_error(:invalid_name), do: "Name cannot be blank"
  defp format_error(_), do: "Action not allowed"

  # Normalizes zone names coming from the client.
  defp to_atom_zone("hand"), do: :hand
  defp to_atom_zone("table"), do: :table
  defp to_atom_zone("discard"), do: :discard
  defp to_atom_zone("deck"), do: :deck
  defp to_atom_zone(_), do: :hand

  # Fetches the latest game state for the current player.
  defp sync_state(socket) do
    {:ok, game, player_id, available_decks} =
      GameServer.sync(socket.assigns.game_code, socket.assigns.player_id)

    %{game: game, player_id: player_id, available_decks: available_decks}
  end
end
