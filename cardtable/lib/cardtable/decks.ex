defmodule Cardtable.Decks do
  @moduledoc """
  Loads deck definitions from static JSON files for the game server.

  This module is used by `Cardtable.GameServer` during game creation and
  restarts to supply card and quirk data.
  """

  @type deck_type :: :cards | :quirks

  @doc "Lists available deck directory names for the given deck type."
  def list_decks(type) when type in [:cards, :quirks] do
    type
    |> decks_root()
    |> File.ls()
    |> case do
      {:ok, entries} ->
        entries
        |> Enum.filter(&deck_dir?(type, &1))
        |> Enum.sort()
      {:error, _} ->
        []
    end
  end

  @doc "Loads a deck's cards from JSON and normalizes the card fields."
  def load_deck(type, name) when type in [:cards, :quirks] and is_binary(name) do
    path = deck_json_path(type, name)

    with {:ok, contents} <- File.read(path),
         {:ok, decoded} <- Jason.decode(contents),
         {:ok, cards, back_image} <- normalize_cards(decoded, type, name) do
      {:ok, %{cards: cards, back_image: back_image}}
    else
      {:error, reason} -> {:error, reason}
      _ -> {:error, :invalid_deck}
    end
  end

  @doc "Returns the absolute deck.json path for a given deck name."
  def deck_json_path(type, name) do
    Path.join([decks_root(type), name, "deck.json"])
  end

  # Returns the filesystem root where deck folders are stored.
  defp decks_root(type) do
    Path.join([priv_static_root(), "decks", Atom.to_string(type)])
  end

  # Resolves the application's priv/static path for static assets.
  defp priv_static_root do
    :cardtable
    |> :code.priv_dir()
    |> Path.join("static")
  end

  # Checks whether a deck directory exists and contains deck.json.
  defp deck_dir?(type, name) do
    File.dir?(Path.join(decks_root(type), name)) and File.exists?(deck_json_path(type, name))
  end

  # Normalizes a decoded deck JSON map into a list of valid cards.
  defp normalize_cards(%{"cards" => cards} = decoded, type, name) when is_list(cards) do
    normalized =
      cards
      |> Enum.map(&normalize_card/1)
      |> Enum.map(&resolve_card_image(&1, type, name))
      |> Enum.filter(&valid_card?/1)

    back_image = decoded |> Map.get("back_image") |> resolve_asset_path(type, name)

    {:ok, normalized, back_image}
  end

  # Returns an error when the JSON structure does not contain cards.
  defp normalize_cards(_, _type, _name), do: {:error, :invalid_deck}

  # Normalizes a card definition that includes title, body, and image.
  defp normalize_card(%{"title" => title, "body" => body, "image" => image}) do
    %{title: title, body: body, image: image}
  end

  # Normalizes a card definition that includes title and body.
  defp normalize_card(%{"title" => title, "body" => body}) do
    %{title: title, body: body, image: nil}
  end

  # Normalizes a card definition that includes title and image.
  defp normalize_card(%{"title" => title, "image" => image}) do
    %{title: title, body: nil, image: image}
  end

  # Normalizes a card definition that includes body and image.
  defp normalize_card(%{"body" => body, "image" => image}) do
    %{title: nil, body: body, image: image}
  end

  # Normalizes a card definition that includes only title.
  defp normalize_card(%{"title" => title}) do
    %{title: title, body: nil, image: nil}
  end

  # Normalizes a card definition that includes only body.
  defp normalize_card(%{"body" => body}) do
    %{title: nil, body: body, image: nil}
  end

  # Normalizes a card definition that includes only image.
  defp normalize_card(%{"image" => image}) do
    %{title: nil, body: nil, image: image}
  end

  # Returns an empty card for invalid JSON entries.
  defp normalize_card(_), do: %{}

  # Validates that a normalized card has at least one field.
  defp valid_card?(%{title: title, body: body, image: image}) do
    not is_nil(title) or not is_nil(body) or not is_nil(image)
  end

  # Returns false for invalid card shapes.
  defp valid_card?(_), do: false

  # Ensures image paths are absolute to /decks when stored as relative.
  defp resolve_card_image(%{image: image} = card, type, name) do
    %{card | image: resolve_asset_path(image, type, name)}
  end

  defp resolve_card_image(card, _type, _name), do: card

  # Builds a public path to the deck asset if stored as relative.
  defp resolve_asset_path(nil, _type, _name), do: nil

  defp resolve_asset_path("img/" <> _rest = path, type, name) do
    "/decks/#{Atom.to_string(type)}/#{name}/#{path}"
  end

  defp resolve_asset_path(path, _type, _name), do: path
end
