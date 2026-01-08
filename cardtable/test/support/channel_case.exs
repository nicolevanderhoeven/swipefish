defmodule CardtableWeb.ChannelCase do
  @moduledoc """
  Test case template for channel-driven integration tests.

  Uses `Phoenix.ChannelTest` and the Cardtable endpoint for websocket tests.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest

      @endpoint CardtableWeb.Endpoint
    end
  end

  setup _tags do
    :ok
  end
end
