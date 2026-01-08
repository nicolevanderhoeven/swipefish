ExUnit.start()

for file <- Path.wildcard("test/support/**/*.exs") do
  Code.require_file(file)
end
