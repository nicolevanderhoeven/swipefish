defmodule CardtableWeb.HealthController do
  use CardtableWeb, :controller

  def index(conn, _params) do
    conn
    |> put_resp_content_type("text/plain")
    |> send_resp(200, "ok\n")
  end
end
