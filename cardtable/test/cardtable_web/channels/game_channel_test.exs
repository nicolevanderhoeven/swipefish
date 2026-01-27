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
    assert public1.fish_deck_count == 52
    assert public1.quirk_deck_count > 0

    push(socket1, "game:restart", %{
      "deck_set" => "standard-52",
      "quirk_set" => nil
    })

    assert_broadcast "game:public_update", %{public_state: public_restart}
    assert public_restart.deck_set == "standard-52"
    assert public_restart.fish_deck_count == 52
    assert public_restart.quirk_deck_count == 0

    {_public_after_draw1, _private_after_draw1} =
      Enum.reduce(1..5, {public_restart, private1}, fn _, _acc ->
        push(socket1, "game:draw", %{"to_zone" => "hand"})
        assert_broadcast "game:public_update", %{public_state: public_state}
        assert_push "game:private_update", %{private_state: private_state}
        {public_state, private_state}
      end)

    {:ok, game_after_draw1, _player_id, available_decks1} =
      GameServer.sync(code, reply1.player_id)

    public_after_draw1 = Game.public_state(game_after_draw1, available_decks1)
    private_after_draw1 = Game.private_state(game_after_draw1, reply1.player_id)

    assert length(private_after_draw1.fish_hand) == 5
    assert length(private_after_draw1.quirk_hand) == 0
    assert public_after_draw1.fish_deck_count == 47

    [card1 | _] = private_after_draw1.fish_hand

    push(socket1, "game:move_card", %{
      "card_id" => card1.card_id,
      "from_zone" => "hand",
      "to_zone" => "table"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_table}
    assert_push "game:private_update", %{private_state: _private_after_table}

    {:ok, game_after_table1, _player_id, available_decks_table1} =
      GameServer.sync(code, reply1.player_id)

    public_after_table1 = Game.public_state(game_after_table1, available_decks_table1)
    private_after_table1 = Game.private_state(game_after_table1, reply1.player_id)

    assert length(private_after_table1.fish_hand) == 4
    assert card1.card_id in Map.get(game_after_table1.table_rows, reply1.player_id, [])
    assert table_contains?(public_after_table1.table, reply1.player_id, card1.card_id)
    assert table_face_state?(public_after_table1.table, card1.card_id, "down")

    push(socket1, "game:flip_table_card", %{"card_id" => card1.card_id})
    assert_broadcast "game:public_update", %{public_state: _public_after_flip}
    assert_push "game:private_update", %{private_state: _private_after_flip}

    {:ok, game_after_flip1, _player_id, available_decks_flip1} =
      GameServer.sync(code, reply1.player_id)

    public_after_flip1 = Game.public_state(game_after_flip1, available_decks_flip1)
    assert table_face_state?(public_after_flip1.table, card1.card_id, "up")

    {:ok, reply2, socket2} =
      subscribe_and_join(socket(UserSocket, nil, %{}), "game:#{code}", %{
        "player_name" => "Player 2"
      })

    assert reply2.ok
    assert_broadcast "game:public_update", %{public_state: public_after_join2}
    assert_push "game:private_update", %{private_state: private2}

    assert length(public_after_join2.players) == 2
    assert Enum.any?(public_after_join2.players, &(&1.name == "Player 2"))
    assert private2.fish_hand == []
    assert private2.quirk_hand == []

    push(socket1, "game:update_name", %{"name" => "Player One"})
    assert_broadcast "game:public_update", %{public_state: _public_after_name}

    {game_after_name, available_decks_name} =
      await_player_name(code, reply2.player_id, reply1.player_id, "Player One")

    public_after_name = Game.public_state(game_after_name, available_decks_name)
    assert Enum.any?(public_after_name.players, &(&1.name == "Player One"))

    {_public_after_draw2, _private_after_draw2} =
      Enum.reduce(1..5, {public_after_join2, private2}, fn _, _acc ->
        push(socket2, "game:draw", %{"to_zone" => "hand"})
        assert_broadcast "game:public_update", %{public_state: public_state}
        assert_push "game:private_update", %{private_state: private_state}
        {public_state, private_state}
      end)

    {game_after_draw2, available_decks2} = await_fish_hand_count(code, reply2.player_id, 5)
    public_after_draw2 = Game.public_state(game_after_draw2, available_decks2)
    private_after_draw2 = Game.private_state(game_after_draw2, reply2.player_id)

    assert length(private_after_draw2.fish_hand) == 5
    assert public_after_draw2.fish_deck_count == 42

    p2_card = hd(private_after_draw2.fish_hand)

    push(socket2, "game:move_card", %{
      "card_id" => p2_card.card_id,
      "from_zone" => "hand",
      "to_zone" => "table"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_table2}
    assert_push "game:private_update", %{private_state: _private_after_table2}

    {game_after_table2, available_decks_table2} = await_fish_hand_count(code, reply2.player_id, 4)
    public_after_table2 = Game.public_state(game_after_table2, available_decks_table2)
    private_after_table2 = Game.private_state(game_after_table2, reply2.player_id)

    assert length(private_after_table2.fish_hand) == 4
    assert p2_card.card_id in Map.get(game_after_table2.table_rows, reply2.player_id, [])
    assert table_contains?(public_after_table2.table, reply2.player_id, p2_card.card_id)

    push(socket1, "game:move_card", %{
      "card_id" => p2_card.card_id,
      "from_zone" => "table",
      "to_zone" => "hand"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_take}
    assert_push "game:private_update", %{private_state: _private_after_take}

    {game_after_take, available_decks_after_take} =
      await_fish_hand_count(code, reply1.player_id, 5)

    public_after_take = Game.public_state(game_after_take, available_decks_after_take)
    private_after_take = Game.private_state(game_after_take, reply1.player_id)

    assert length(private_after_take.fish_hand) == 5
    refute table_contains_any?(public_after_take.table, p2_card.card_id)

    p2_discard_card = hd(private_after_table2.fish_hand)

    push(socket2, "game:move_card", %{
      "card_id" => p2_discard_card.card_id,
      "from_zone" => "hand",
      "to_zone" => "discard"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_discard}
    assert_push "game:private_update", %{private_state: _private_after_discard}

    {game_after_discard, available_decks_discard} = await_fish_discard_top(code, reply2.player_id)
    public_after_discard = Game.public_state(game_after_discard, available_decks_discard)
    private_after_discard = Game.private_state(game_after_discard, reply2.player_id)

    assert public_after_discard.fish_discard_top
    assert length(private_after_discard.fish_hand) == 3

    discard_card_id = public_after_discard.fish_discard_top.card_id

    push(socket1, "game:move_card", %{
      "card_id" => discard_card_id,
      "from_zone" => "discard",
      "to_zone" => "table"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_discard_to_table}

    {game_after_discard_to_table, available_decks_discard_to_table} =
      await_table_contains(code, reply1.player_id, discard_card_id)

    public_after_discard_to_table =
      Game.public_state(game_after_discard_to_table, available_decks_discard_to_table)

    assert table_contains_any?(public_after_discard_to_table.table, discard_card_id)

    push(socket1, "game:move_card", %{
      "card_id" => discard_card_id,
      "from_zone" => "table",
      "to_zone" => "discard"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_table_to_discard}

    {game_after_table_to_discard, available_decks_table_to_discard} =
      await_fish_discard_top(code, reply1.player_id)

    public_after_table_to_discard =
      Game.public_state(game_after_table_to_discard, available_decks_table_to_discard)

    assert public_after_table_to_discard.fish_discard_top
    assert public_after_table_to_discard.fish_discard_top.card_id == discard_card_id

    push(socket1, "game:move_card", %{
      "card_id" => discard_card_id,
      "from_zone" => "discard",
      "to_zone" => "hand"
    })

    assert_broadcast "game:public_update", %{public_state: _public_after_discard_to_hand}

    {game_after_discard_to_hand, _available_decks_discard_to_hand} =
      await_hand_contains(code, reply1.player_id, discard_card_id)

    private_after_discard_to_hand =
      Game.private_state(game_after_discard_to_hand, reply1.player_id)

    assert Enum.any?(private_after_discard_to_hand.fish_hand, &(&1.card_id == discard_card_id))

    player1 = Enum.find(public_after_discard.players, &(&1.id == reply1.player_id))
    player2 = Enum.find(public_after_discard.players, &(&1.id == reply2.player_id))

    assert player1.fish_hand_count == 5
    assert player2.fish_hand_count == 3
    assert public_after_discard.fish_deck_count == 42

    p2_remaining_ids = Enum.map(private_after_discard.fish_hand, & &1.card_id)
    p1_hand_ids = Enum.map(private_after_take.fish_hand, & &1.card_id)
    assert Enum.all?(p2_remaining_ids, fn card_id -> card_id not in p1_hand_ids end)

    assert Map.has_key?(public_after_discard, :players)
    refute Map.has_key?(public_after_discard, :hands)
  end

  test "can draw from quirk deck and discard/shuffle quirks" do
    code = "Q#{System.unique_integer([:positive])}"

    {:ok, reply, socket} =
      subscribe_and_join(socket(UserSocket, nil, %{}), "game:#{code}", %{
        "player_name" => "Player 1"
      })

    assert reply.ok
    assert_broadcast "game:public_update", %{public_state: public0}
    assert_push "game:private_update", %{private_state: private0}
    assert public0.quirk_deck_count > 0
    assert private0.quirk_hand == []

    push(socket, "game:draw", %{"deck" => "quirk", "to_zone" => "hand"})
    assert_broadcast "game:public_update", %{public_state: public1}
    assert_push "game:private_update", %{private_state: private1}
    assert length(private1.quirk_hand) == 1
    assert public1.quirk_deck_count == public0.quirk_deck_count - 1

    quirk_card_id = hd(private1.quirk_hand).card_id

    push(socket, "game:move_card", %{
      "card_id" => quirk_card_id,
      "from_zone" => "hand",
      "to_zone" => "discard"
    })

    assert_broadcast "game:public_update", %{public_state: public2}
    assert public2.quirk_discard_top
    assert public2.quirk_discard_top.card_id == quirk_card_id

    push(socket, "game:shuffle_quirk_discard_into_deck", %{})
    assert_broadcast "game:public_update", %{public_state: public3}
    assert public3.quirk_discard_count == 0
    assert public3.quirk_deck_count == public2.quirk_deck_count + 1
  end

  # Polls the game server until the player's hand reaches the expected size.
  defp await_fish_hand_count(code, player_id, expected_count, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    hand = Map.get(game.fish_hands, player_id, [])
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

        await_fish_hand_count(code, player_id, expected_count,
          attempts: attempts - 1,
          delay_ms: delay_ms
        )
    end
  end

  # Polls the game server until the player's hand contains the target card.
  defp await_hand_contains(code, player_id, card_id, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    private_state = Game.private_state(game, player_id)

    present? =
      Enum.any?(private_state.fish_hand, &(&1.card_id == card_id)) or
        Enum.any?(private_state.quirk_hand, &(&1.card_id == card_id))

    cond do
      present? ->
        {game, available_decks}

      attempts <= 1 ->
        flunk(
          "Expected hand to include card #{card_id}, but it was missing after #{attempts} attempts."
        )

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

        await_player_name(code, player_id, target_player_id, expected_name,
          attempts: attempts - 1,
          delay_ms: delay_ms
        )
    end
  end

  # Polls the game server until the table contains the specified card.
  defp await_table_contains(code, player_id, card_id, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    has_card = Enum.any?(game.table_rows, fn {_pid, row} -> Enum.member?(row, card_id) end)

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
  defp await_fish_discard_top(code, player_id, opts \\ []) do
    attempts = Keyword.get(opts, :attempts, 5)
    delay_ms = Keyword.get(opts, :delay_ms, 10)

    {:ok, game, _player_id, available_decks} = GameServer.sync(code, player_id)
    has_discard = game.fish_discard != []

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
        await_fish_discard_top(code, player_id, attempts: attempts - 1, delay_ms: delay_ms)
    end
  end

  defp table_contains?(table_rows, player_id, card_id) do
    Enum.any?(table_rows, fn row ->
      row.player_id == player_id and Enum.any?(row.cards, &(&1.card_id == card_id))
    end)
  end

  defp table_contains_any?(table_rows, card_id) do
    Enum.any?(table_rows, fn row -> Enum.any?(row.cards, &(&1.card_id == card_id)) end)
  end

  defp table_face_state?(table_rows, card_id, expected) do
    Enum.any?(table_rows, fn row ->
      Enum.any?(row.cards, fn c ->
        c.card_id == card_id and Map.get(c, :face_state) == expected
      end)
    end)
  end
end
