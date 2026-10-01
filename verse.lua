-- PopuliVerse: wherever the name stands in the running text of a page,
-- "Verse" is set in italics: PopuliVerse becomes Populi + Verse (italic).
--
-- It works on the text of every page and on its title, in the web page and
-- in the PDF alike. It leaves alone what cannot carry italics or must stay
-- plain: the title shown in the browser tab, descriptions for search
-- engines, web addresses, code, and citation data.

local NAME = "PopuliVerse"

-- One piece of text -> the same text with "Verse" in italics, or nil when
-- the name is not in it.
local function split(text)
  local out = {}
  local pos = 1
  while true do
    local a, b = string.find(text, NAME, pos, true)
    if not a then break end
    if a > pos then table.insert(out, pandoc.Str(string.sub(text, pos, a - 1))) end
    table.insert(out, pandoc.Str("Populi"))
    table.insert(out, pandoc.Emph({ pandoc.Str("Verse") }))
    pos = b + 1
  end
  if pos == 1 then return nil end
  if pos <= #text then table.insert(out, pandoc.Str(string.sub(text, pos))) end
  return out
end

local walker = { Str = function(el) return split(el.text) end }

function Pandoc(doc)
  -- the text of the page
  doc.blocks = doc.blocks:walk(walker)
  -- the title, the subtitle and the short description shown at the top of the page
  for _, key in ipairs({ "title", "subtitle", "description" }) do
    local value = doc.meta[key]
    if value ~= nil and pandoc.utils.type(value) == "Inlines" then
      doc.meta[key] = value:walk(walker)
    end
  end
  return doc
end
