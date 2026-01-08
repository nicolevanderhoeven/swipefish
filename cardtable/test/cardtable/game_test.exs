defmodule Cardtable.GameTest do
  use ExUnit.Case, async: true

  alias Cardtable.Game

  defp sample_cards do
    [
      %{title: "Card One", body: nil, image: nil},
      %{title: "Card Two", body: nil, image: nil},
      %{title: "Card Three", body: nil, image: nil}
    ]
  end

  test "draw moves a card from deck to player hand" do
    game = Game.new("TEST", "sample", nil, sample_cards(), [], shuffle: false)
    game = Game.add_player(game, "p1", "Player 1")

    assert length(game.deck) == 3
    {:ok, game} = Game.draw(game, "p1", :hand)

    assert length(game.deck) == 2
    assert length(game.hands["p1"]) == 1
  end

  test "move card from hand to table updates table state" do
    game = Game.new("TEST", "sample", nil, sample_cards(), [], shuffle: false)
    game = Game.add_player(game, "p1", "Player 1")
    {:ok, game} = Game.draw(game, "p1", :hand)

    [card_id | _] = game.hands["p1"]
    {:ok, game} = Game.move_card(game, "p1", card_id, :hand, :table, nil)

    assert game.hands["p1"] == []
    assert card_id in game.table.cards
    assert game.table.states[card_id] == :down
  end

  test "steal random removes a card from another hand" do
    :rand.seed(:exsplus, {1, 2, 3})

    game = Game.new("TEST", "sample", nil, sample_cards(), [], shuffle: false)
    game = Game.add_player(game, "p1", "Player 1")
    game = Game.add_player(game, "p2", "Player 2")

    {:ok, game} = Game.draw(game, "p1", :hand)
    {:ok, game} = Game.draw(game, "p2", :hand)

    assert length(game.hands["p1"]) == 1
    assert length(game.hands["p2"]) == 1

    {:ok, game} = Game.steal_random(game, "p1", "p2", :hand)

    assert length(game.hands["p1"]) == 2
    assert game.hands["p2"] == []
  end
end
