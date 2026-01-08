defmodule CardtableWeb.PageController do
  use CardtableWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
