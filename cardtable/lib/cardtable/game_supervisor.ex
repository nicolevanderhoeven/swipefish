defmodule Cardtable.GameSupervisor do
  @moduledoc """
  Dynamic supervisor that owns all running game servers.

  `Cardtable.GameServer` processes are started on-demand per game code.
  """

  use DynamicSupervisor

  @doc "Starts the dynamic supervisor for game processes."
  def start_link(_arg) do
    DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @impl true
  @doc "Initializes the supervisor strategy for game servers."
  def init(:ok) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
