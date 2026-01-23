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

  defp sample_quirks do
    [
      %{title: "Quirk One", body: nil, image: nil},
      %{title: "Quirk Two", body: nil, image: nil}
    ]
  end

  test "draw moves a fish card from fish deck to player fish hand" do
    game = Game.new("TEST", "sample", nil, sample_cards(), sample_quirks(), shuffle: false)
    game = Game.add_player(game, "p1", "Player 1")

    assert length(game.fish_deck) == 3
    {:ok, game} = Game.draw(game, "p1", :hand)

    assert length(game.fish_deck) == 2
    assert length(game.fish_hands["p1"]) == 1
    assert game.quirk_hands["p1"] == []
  end

  test "draw can target the quirk deck" do
    game = Game.new("TEST", "sample", "sample-quirks", sample_cards(), sample_quirks(), shuffle: false)
    game = Game.add_player(game, "p1", "Player 1")

    assert length(game.quirk_deck) == 2
    {:ok, game} = Game.draw(game, "p1", :quirk, :hand)

    assert length(game.quirk_deck) == 1
    assert length(game.quirk_hands["p1"]) == 1
  end

  test "move card from hand to table puts it into the player's table row" do
    game = Game.new("TEST", "sample", "sample-quirks", sample_cards(), sample_quirks(), shuffle: false)
    game = Game.add_player(game, "p1", "Player 1")
    {:ok, game} = Game.draw(game, "p1", :hand)

    [card_id | _] = game.fish_hands["p1"]
    {:ok, game} = Game.move_card(game, "p1", card_id, :hand, :table, nil)

    assert game.fish_hands["p1"] == []
    assert card_id in Map.get(game.table_rows, "p1", [])
    assert Map.get(game.table_faces, card_id) == :down

    public = Game.public_state(game, %{cards: [], quirks: []})
    table_card = public.table |> hd() |> Map.fetch!(:cards) |> Enum.find(&(&1.card_id == card_id))
    assert table_card.face_state == "down"
    assert table_card.face == nil

    {:ok, game} = Game.flip_table_card(game, card_id)
    public2 = Game.public_state(game, %{cards: [], quirks: []})
    table_card2 = public2.table |> hd() |> Map.fetch!(:cards) |> Enum.find(&(&1.card_id == card_id))
    assert table_card2.face_state == "up"
    assert table_card2.face
  end

  test "steal random removes a card from another hand" do
    :rand.seed(:exsplus, {1, 2, 3})

    game = Game.new("TEST", "sample", "sample-quirks", sample_cards(), sample_quirks(), shuffle: false)
    game = Game.add_player(game, "p1", "Player 1")
    game = Game.add_player(game, "p2", "Player 2")

    {:ok, game} = Game.draw(game, "p1", :hand)
    {:ok, game} = Game.draw(game, "p2", :hand)

    assert length(game.fish_hands["p1"]) == 1
    assert length(game.fish_hands["p2"]) == 1

    {:ok, game} = Game.steal_random(game, "p1", "p2", :hand)

    assert length(game.fish_hands["p1"]) == 2
    assert game.fish_hands["p2"] == []
  end
end
