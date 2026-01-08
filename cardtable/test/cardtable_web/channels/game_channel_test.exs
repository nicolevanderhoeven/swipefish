defmodule CardtableWeb.GameChannelTest do
  @moduledoc """
  Channel-level flow test that exercises the main player transitions and visibility rules.
  """

  use CardtableWeb.ChannelCase, async: true

  alias Cardtable.Game
  alias Cardtable.GameServer
  alias CardtableWeb.UserSocket

  @doc "Verifies the multi-player flow and public/private state visibility rules."
  test "player transitions and visibility" do
    code = "T#{System.unique_integer([:positive])}"

    {:ok, reply1, socket1} =
      subscribe_and_join(socket(UserSocket, nil, %{}), "game:#{code}", %{
        "player_name" => "Player 1"
      })

    assert reply1.ok
    assert_broadcast "game:public_update", %{public_state: public1}
    assert_push "game:private_update", %{private_state: private1}

    assert public1.deck_set == "swipefish"
    assert public1.deck_count == 52

    push(socket1, "game:restart", %{
      "deck_set" => "standard-52",
      "quirk_set" => nil
    })

    assert_broadcast "game:public_update", %{public_state: public_restart}
    assert public_restart.deck_set == "standard-52"
    assert public_restart.deck_count == 52

    {_public_after_draw1, _private_after_draw1} =
      Enum.reduce(1..5, {public_restart, private1}, fn _, _acc ->
        push(socket1, "game:draw", %{"to_zone" => "hand"})
        assert_broadcast "game:public_update", %{public_state: public_state}
        assert_push "game:private_update", %{private_state: private_state}
        {public_state, private_state}
      end)

    {:ok, game_after_draw1, _player_id, available_decks1} = GameServer.sync(code, reply1.player_id)
    public_after_draw1 = Game.public_state(game_after_draw1, available_decks1)
    private_after_draw1 = Game.private_state(game_after_draw1, reply1.player_id)

    assert length(private_after_draw1.hand) == 5
    assert public_after_draw1.deck_count == 47

    [card1 | _] = private_after_draw1.hand

    push(socket1, "game:move_card", %{
      "card_id" => card1.card_id,
      "from_zone" => "hand",
      "to_zone" => "table"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_table}
    assert_push "game:private_update", %{private_state: _private_after_table}

    {:ok, game_after_table1, _player_id, available_decks_table1} = GameServer.sync(code, reply1.player_id)
    public_after_table1 = Game.public_state(game_after_table1, available_decks_table1)
    private_after_table1 = Game.private_state(game_after_table1, reply1.player_id)

    assert length(private_after_table1.hand) == 4
    assert Enum.any?(public_after_table1.table, &(&1.card_id == card1.card_id))
    assert Enum.member?(game_after_table1.table.cards, card1.card_id)
    states_after_table1 = Map.get(game_after_table1.table, :states, %{})
    assert Map.has_key?(states_after_table1, card1.card_id)

    push(socket1, "game:flip_table_card", %{"card_id" => card1.card_id})
    assert_broadcast "game:public_update", %{public_state: _public_after_flip1}

    {game_after_flip1, available_decks1} =
      await_table_state(code, reply1.player_id, card1.card_id, :up)

    public_after_flip1 = Game.public_state(game_after_flip1, available_decks1)
    table1 = game_after_flip1.table
    states1 = Map.get(table1, :states, %{})
    assert Map.get(states1, card1.card_id) == :up
    assert Enum.find(public_after_flip1.table, &(&1.card_id == card1.card_id))

    {:ok, reply2, socket2} =
      subscribe_and_join(socket(UserSocket, nil, %{}), "game:#{code}", %{
        "player_name" => "Player 2"
      })

    assert reply2.ok
    assert_broadcast "game:public_update", %{public_state: public_after_join2}
    assert_push "game:private_update", %{private_state: private2}

    assert length(public_after_join2.players) == 2
    assert Enum.any?(public_after_join2.players, &(&1.name == "Player 2"))
    assert private2.hand == []

    push(socket1, "game:update_name", %{"name" => "Player One"})
    assert_broadcast "game:public_update", %{public_state: _public_after_name}

    {game_after_name, available_decks_name} = await_player_name(code, reply2.player_id, reply1.player_id, "Player One")
    public_after_name = Game.public_state(game_after_name, available_decks_name)
    assert Enum.any?(public_after_name.players, &(&1.name == "Player One"))

    {_public_after_draw2, _private_after_draw2} =
      Enum.reduce(1..5, {public_after_join2, private2}, fn _, _acc ->
        push(socket2, "game:draw", %{"to_zone" => "hand"})
        assert_broadcast "game:public_update", %{public_state: public_state}
        assert_push "game:private_update", %{private_state: private_state}
        {public_state, private_state}
      end)

    {game_after_draw2, available_decks2} = await_hand_count(code, reply2.player_id, 5)
    public_after_draw2 = Game.public_state(game_after_draw2, available_decks2)
    private_after_draw2 = Game.private_state(game_after_draw2, reply2.player_id)

    assert length(private_after_draw2.hand) == 5
    assert public_after_draw2.deck_count == 42

    p2_card = hd(private_after_draw2.hand)

    push(socket2, "game:move_card", %{
      "card_id" => p2_card.card_id,
      "from_zone" => "hand",
      "to_zone" => "table"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_table2}
    assert_push "game:private_update", %{private_state: _private_after_table2}

    {game_after_table2, available_decks_table2} = await_hand_count(code, reply2.player_id, 4)
    public_after_table2 = Game.public_state(game_after_table2, available_decks_table2)
    private_after_table2 = Game.private_state(game_after_table2, reply2.player_id)

    assert length(private_after_table2.hand) == 4
    assert Enum.any?(public_after_table2.table, &(&1.card_id == p2_card.card_id))
    assert Enum.member?(game_after_table2.table.cards, p2_card.card_id)
    states_after_table2 = Map.get(game_after_table2.table, :states, %{})
    assert Map.has_key?(states_after_table2, p2_card.card_id)

    push(socket2, "game:flip_table_card", %{"card_id" => p2_card.card_id})
    assert_broadcast "game:public_update", %{public_state: _public_after_flip2}

    {game_after_flip2, available_decks2} =
      await_table_state(code, reply2.player_id, p2_card.card_id, :up)

    public_after_flip2 = Game.public_state(game_after_flip2, available_decks2)
    table2 = game_after_flip2.table
    states2 = Map.get(table2, :states, %{})
    assert Map.get(states2, p2_card.card_id) == :up
    assert Enum.find(public_after_flip2.table, &(&1.card_id == p2_card.card_id))

    push(socket1, "game:move_card", %{
      "card_id" => p2_card.card_id,
      "from_zone" => "table",
      "to_zone" => "hand"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_take}
    assert_push "game:private_update", %{private_state: _private_after_take}

    {game_after_take, available_decks_after_take} = await_hand_count(code, reply1.player_id, 5)
    public_after_take = Game.public_state(game_after_take, available_decks_after_take)
    private_after_take = Game.private_state(game_after_take, reply1.player_id)

    assert length(private_after_take.hand) == 5
    assert Enum.all?(public_after_take.table, &(&1.card_id != p2_card.card_id))

    p2_discard_card = hd(private_after_table2.hand)

    push(socket2, "game:move_card", %{
      "card_id" => p2_discard_card.card_id,
      "from_zone" => "hand",
      "to_zone" => "discard"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_discard}
    assert_push "game:private_update", %{private_state: _private_after_discard}

    {game_after_discard, available_decks_discard} = await_discard_top(code, reply2.player_id)
    public_after_discard = Game.public_state(game_after_discard, available_decks_discard)
    private_after_discard = Game.private_state(game_after_discard, reply2.player_id)

    assert public_after_discard.discard_top
    assert length(private_after_discard.hand) == 3

    discard_card_id = public_after_discard.discard_top.card_id

    push(socket1, "game:move_card", %{
      "card_id" => discard_card_id,
      "from_zone" => "discard",
      "to_zone" => "table"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_discard_to_table}
    {game_after_discard_to_table, available_decks_discard_to_table} =
      await_table_contains(code, reply1.player_id, discard_card_id)

    public_after_discard_to_table = Game.public_state(game_after_discard_to_table, available_decks_discard_to_table)
    assert Enum.any?(public_after_discard_to_table.table, &(&1.card_id == discard_card_id))

    push(socket1, "game:move_card", %{
      "card_id" => discard_card_id,
      "from_zone" => "table",
      "to_zone" => "discard"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_table_to_discard}
    {game_after_table_to_discard, available_decks_table_to_discard} =
      await_discard_top(code, reply1.player_id)

    public_after_table_to_discard = Game.public_state(game_after_table_to_discard, available_decks_table_to_discard)
    assert public_after_table_to_discard.discard_top
    assert public_after_table_to_discard.discard_top.card_id == discard_card_id

    push(socket1, "game:move_card", %{
      "card_id" => discard_card_id,
      "from_zone" => "discard",
      "to_zone" => "hand"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_discard_to_hand}
    {game_after_discard_to_hand, _available_decks_discard_to_hand} =
      await_hand_contains(code, reply1.player_id, discard_card_id)

    private_after_discard_to_hand = Game.private_state(game_after_discard_to_hand, reply1.player_id)
    assert Enum.any?(private_after_discard_to_hand.hand, &(&1.card_id == discard_card_id))

    player1 = Enum.find(public_after_discard.players, &(&1.id == reply1.player_id))
    player2 = Enum.find(public_after_discard.players, &(&1.id == reply2.player_id))

    assert player1.hand_count == 5
    assert player2.hand_count == 3
    assert public_after_discard.deck_count == 42

    p2_remaining_ids = Enum.map(private_after_discard.hand, & &1.card_id)
    p1_hand_ids = Enum.map(private_after_take.hand, & &1.card_id)
    assert Enum.all?(p2_remaining_ids, fn card_id -> card_id not in p1_hand_ids end)

    assert Map.has_key?(public_after_discard, :players)
    refute Map.has_key?(public_after_discard, :hands)
  end

  # Polls the game server until the table card reaches the expected face state.
  defp await_table_state(code, player_id, card_id, expected_state, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    states = Map.get(game.table, :states, %{})
    current = Map.get(states, card_id)

    cond do
      current == expected_state ->
        {game, available_decks}

      attempts <= 1 ->
        flunk(
          "Expected card #{card_id} to reach #{inspect(expected_state)} " <>
            "but got #{inspect(current)} after #{attempts} attempts (delay #{delay_ms}ms)."
        )

      true ->
        Process.sleep(delay_ms)
        await_table_state(code, player_id, card_id, expected_state, attempts: attempts - 1, delay_ms: delay_ms)
    end
  end

  # Polls the game server until the player's hand reaches the expected size.
  defp await_hand_count(code, player_id, expected_count, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    hand = Map.get(game.hands, player_id, [])
    current = length(hand)

    cond do
      current == expected_count ->
        {game, available_decks}

      attempts <= 1 ->
        flunk(
          "Expected hand size #{expected_count} for #{player_id} but got #{current} " <>
            "after #{attempts} attempts (delay #{delay_ms}ms)."
        )

      true ->
        Process.sleep(delay_ms)
        await_hand_count(code, player_id, expected_count, attempts: attempts - 1, delay_ms: delay_ms)
    end
  end

  # Polls the game server until the player's hand contains the target card.
  defp await_hand_contains(code, player_id, card_id, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    private_state = Game.private_state(game, player_id)
    present? = Enum.any?(private_state.hand, &(&1.card_id == card_id))

    cond do
      present? ->
        {game, available_decks}

      attempts <= 1 ->
        flunk("Expected hand to include card #{card_id}, but it was missing after #{attempts} attempts.")

      true ->
        Process.sleep(delay_ms)
        await_hand_contains(code, player_id, card_id, attempts: attempts - 1, delay_ms: delay_ms)
    end
  end

  # Polls the game server until the player has the expected display name.
  defp await_player_name(code, player_id, target_player_id, expected_name, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    current = game.players[target_player_id][:name]

    cond do
      current == expected_name ->
        {game, available_decks}

      attempts <= 1 ->
        flunk(
          "Expected player #{target_player_id} to be #{inspect(expected_name)} but got #{inspect(current)} " <>
            "after #{attempts} attempts (delay #{delay_ms}ms)."
        )

      true ->
        Process.sleep(delay_ms)
        await_player_name(code, player_id, target_player_id, expected_name, attempts: attempts - 1, delay_ms: delay_ms)
    end
  end

  # Polls the game server until the table contains the specified card.
  defp await_table_contains(code, player_id, card_id, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    has_card = Enum.member?(game.table.cards, card_id)

    cond do
      has_card ->
        {game, available_decks}

      attempts <= 1 ->
        flunk(
          "Expected table to contain #{card_id} but it was not present after #{attempts} attempts " <>
            "(delay #{delay_ms}ms)."
        )

      true ->
        Process.sleep(delay_ms)
        await_table_contains(code, player_id, card_id, attempts: attempts - 1, delay_ms: delay_ms)
    end
  end

  # Polls the game server until there is a discard top card.
  defp await_discard_top(code, player_id, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    has_discard = game.discard != []

    cond do
      has_discard ->
        {game, available_decks}

      attempts <= 1 ->
        flunk(
          "Expected discard top card but discard pile was empty after #{attempts} attempts " <>
            "(delay #{delay_ms}ms)."
        )

      true ->
        Process.sleep(delay_ms)
        await_discard_top(code, player_id, attempts: attempts - 1, delay_ms: delay_ms)
    end
  end
end
