defmodule Cardtable.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      CardtableWeb.Telemetry,
      {DNSCluster, query: Application.get_env(:cardtable, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Cardtable.PubSub},
      {Registry, keys: :unique, name: Cardtable.GameRegistry},
      Cardtable.GameSupervisor,
      # Start a worker by calling: Cardtable.Worker.start_link(arg)
      # {Cardtable.Worker, arg},
      # Start to serve requests, typically the last entry
      CardtableWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Cardtable.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    CardtableWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
