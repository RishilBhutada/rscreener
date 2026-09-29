"""What the commodities fetcher and exporter both need to agree on: what each
MCX contract is called, how it is priced, and which world contract it
follows.

An MCX price is rupees per a quoted amount that differs by contract - gold per
10 g, silver per kg, crude per barrel - and the contract itself is a multiple
of that (`mult` in the contracts table: GOLD is 100 x 10 g = 1 kg). The world
comparison converts a dollar futures price into those same rupees:

    world in rupees = world price x USD/INR x FACTOR

where FACTOR turns the world unit into the MCX quoted amount (troy ounces into
10 g, pounds into kg...). What is left between MCX and that number is import
duty, local supply and demand, and the hour between the two closes.
"""
from datetime import date

TROY_OZ_G = 31.1034768
LB_KG = 0.45359237

# root: (name, group, quoted as, family head)
ROOTS: dict[str, tuple[str, str, str, str]] = {
    "GOLD": ("Gold", "Bullion", "₹ per 10 g", "GOLD"),
    "GOLDM": ("Gold Mini", "Bullion", "₹ per 10 g", "GOLD"),
    "GOLDTEN": ("Gold Ten", "Bullion", "₹ per 10 g", "GOLD"),
    "GOLDGUINEA": ("Gold Guinea", "Bullion", "₹ per 8 g", "GOLD"),
    "GOLDPETAL": ("Gold Petal", "Bullion", "₹ per 1 g", "GOLD"),
    "SILVER": ("Silver", "Bullion", "₹ per kg", "SILVER"),
    "SILVERM": ("Silver Mini", "Bullion", "₹ per kg", "SILVER"),
    "SILVERMIC": ("Silver Micro", "Bullion", "₹ per kg", "SILVER"),
    "SILVER100": ("Silver 100", "Bullion", "₹ per 10 g", "SILVER"),
    "CRUDEOIL": ("Crude Oil", "Energy", "₹ per barrel", "CRUDEOIL"),
    "CRUDEOILM": ("Crude Oil Mini", "Energy", "₹ per barrel", "CRUDEOIL"),
    "NATURALGAS": ("Natural Gas", "Energy", "₹ per mmBtu", "NATURALGAS"),
    "NATGASMINI": ("Natural Gas Mini", "Energy", "₹ per mmBtu", "NATURALGAS"),
    "ELECDMBL": ("Electricity", "Energy", "₹ per MWh", "ELECDMBL"),
    "COPPER": ("Copper", "Base metals", "₹ per kg", "COPPER"),
    "ZINC": ("Zinc", "Base metals", "₹ per kg", "ZINC"),
    "ZINCMINI": ("Zinc Mini", "Base metals", "₹ per kg", "ZINC"),
    "LEAD": ("Lead", "Base metals", "₹ per kg", "LEAD"),
    "LEADMINI": ("Lead Mini", "Base metals", "₹ per kg", "LEAD"),
    "ALUMINIUM": ("Aluminium", "Base metals", "₹ per kg", "ALUMINIUM"),
    "ALUMINI": ("Aluminium Mini", "Base metals", "₹ per kg", "ALUMINIUM"),
    "NICKEL": ("Nickel", "Base metals", "₹ per kg", "NICKEL"),
    "STEELREBAR": ("Steel Rebar", "Base metals", "₹ per tonne", "STEELREBAR"),
    "COTTON": ("Cotton", "Agri", "₹ per bale", "COTTON"),
    "KAPAS": ("Kapas", "Agri", "₹ per 20 kg", "KAPAS"),
    "COTTONOIL": ("Cotton Seed Oil", "Agri", "₹ per 10 kg", "COTTONOIL"),
    "MENTHAOIL": ("Mentha Oil", "Agri", "₹ per kg", "MENTHAOIL"),
    "CARDAMOM": ("Cardamom", "Agri", "₹ per kg", "CARDAMOM"),
    "MCXBULLDEX": ("MCX Bulldex", "Indices", "points", "MCXBULLDEX"),
    "MCXMETLDEX": ("MCX Metldex", "Indices", "points", "MCXMETLDEX"),
}
GROUPS = ["Bullion", "Energy", "Base metals", "Agri", "Indices", "Other"]


def describe(root: str) -> tuple[str, str, str, str]:
    """(name, group, quoted as, family) - a contract MCX adds later still lists."""
    return ROOTS.get(root, (root.title(), "Other", "₹", root))


# The world contract each MCX root follows, on Yahoo:
#   code   - CME root (GC gold, SI silver, CL WTI crude, NG Henry Hub gas,
#            HG copper, ALI aluminium)
#   sfx    - Yahoo's exchange suffix for a single delivery month
#   shift  - months to add to the MCX expiry month. MCX crude expiring on the
#            19th of October settles on NYMEX's November contract, which
#            expires the next day; the same for gas.
#   factor - world unit -> the MCX quoted amount
#   label, unit - how the page names it
WORLD: dict[str, dict] = {}
for _r, _grams in (("GOLD", 10), ("GOLDM", 10), ("GOLDTEN", 10), ("GOLDGUINEA", 8), ("GOLDPETAL", 1)):
    WORLD[_r] = {"code": "GC", "sfx": ".CMX", "shift": 0, "factor": _grams / TROY_OZ_G, "label": "COMEX gold", "unit": "$ per troy oz"}
for _r, _grams in (("SILVER", 1000), ("SILVERM", 1000), ("SILVERMIC", 1000), ("SILVER100", 10)):
    WORLD[_r] = {"code": "SI", "sfx": ".CMX", "shift": 0, "factor": _grams / TROY_OZ_G, "label": "COMEX silver", "unit": "$ per troy oz"}
for _r in ("CRUDEOIL", "CRUDEOILM"):
    WORLD[_r] = {"code": "CL", "sfx": ".NYM", "shift": 1, "factor": 1.0, "label": "NYMEX WTI crude", "unit": "$ per barrel"}
for _r in ("NATURALGAS", "NATGASMINI"):
    WORLD[_r] = {"code": "NG", "sfx": ".NYM", "shift": 1, "factor": 1.0, "label": "NYMEX Henry Hub gas", "unit": "$ per mmBtu"}
WORLD["COPPER"] = {"code": "HG", "sfx": ".CMX", "shift": 0, "factor": 1 / LB_KG, "label": "COMEX copper", "unit": "$ per lb"}
for _r in ("ALUMINIUM", "ALUMINI"):
    WORLD[_r] = {"code": "ALI", "sfx": ".CMX", "shift": 0, "factor": 1 / 1000, "label": "COMEX aluminium", "unit": "$ per tonne"}

FX = "INR=X"
MONTH_CODES = "FGHJKMNQUVXZ"


def world_ticker(root: str, expiry: str) -> str | None:
    """The Yahoo ticker of the world contract matching one MCX expiry."""
    w = WORLD.get(root)
    if not w:
        return None
    d = date.fromisoformat(expiry)
    m, y = d.month + w["shift"], d.year
    if m > 12:
        m, y = m - 12, y + 1
    return f"{w['code']}{MONTH_CODES[m - 1]}{y % 100:02d}{w['sfx']}"


def world_front(root: str) -> str | None:
    """Yahoo's rolling front-month series for the root - the long view."""
    w = WORLD.get(root)
    return f"{w['code']}=F" if w else None
