defmodule CardtableWeb.UserSocket do
  @moduledoc """
  Socket entrypoint for game channels.

  The SPA connects here to join `CardtableWeb.GameChannel` topics.
  """

  use Phoenix.Socket

  channel "game:*", CardtableWeb.GameChannel

  @impl true
  @doc "Accepts all websocket connections for the game client."
  def connect(_params, socket, _connect_info) do
    {:ok, socket}
  end

  @impl true
  @doc "Disables socket-wide identifiers for this connection."
  def id(_socket), do: nil
end
