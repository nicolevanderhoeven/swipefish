defmodule CardtableWeb.LayoutController do
  @moduledoc """
  Persists layout CSS variables for local sandbox tweaking.
  """

  use CardtableWeb, :controller

  @layout_path Path.join([:code.priv_dir(:cardtable), "static", "layout.css"])

  @doc "Writes layout CSS variables to priv/static/layout.css."
  def update(conn, params) do
    css =
      [
        ":root {",
        "  --card-height-r: #{float_param(params, :cardHeightR, 0.28)};",
        "  --hand-center-r: #{float_param(params, :handCenterR, 0)};",
        "  --hand-distance-r: #{float_param(params, :handDistanceR, 1)};",
        "  --hand-angle: #{float_param(params, :handAngle, 8)};",
        "  --quirk-offset-r: #{float_param(params, :quirkOffsetR, 0.18)};",
        "  --pile-up-r: #{float_param(params, :pileUpR, 0.7)};",
        "  --pile-gap-r: #{float_param(params, :pileGapR, 0.9)};",
        "  --pile-scale: #{float_param(params, :pileScale, 0.75)};",
        "  --table-row-r: #{float_param(params, :tableRowR, 0)};",
        "  --table-circle: #{float_param(params, :tableCircle, 1)};",
        "}",
        ""
      ]
      |> Enum.join("\n")

    case File.write(@layout_path, css) do
      :ok -> json(conn, %{ok: true})
      {:error, reason} -> json(conn, %{ok: false, error: inspect(reason)})
    end
  end

  defp float_param(params, key, default) do
    key = to_string(key)

    case Map.get(params, key) do
      nil ->
        default

      value when is_number(value) ->
        value

      value when is_binary(value) ->
        case Float.parse(value) do
          {number, _} -> number
          :error -> default
        end

      _ ->
        default
    end
  end
end
