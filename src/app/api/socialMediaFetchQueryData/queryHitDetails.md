Good, now we can turn this into something you can directly plug into your system.

I’ll give you a **clean production-ready JSON pack** with:

1. Karachi location dictionary (expanded + spelling variants)
2. Distress query templates (modular)
3. Full combined query builders
4. Date-based filtering patterns for APIDirect
5. Ready-to-use “query presets” (what you actually call in code)

---

# 1. Karachi Location JSON (Production Version)

Use this as your **base geo-intent dictionary**

```json
{
  "karachi": {
    "core": [
      "karachi",
      "khi",
      "city of lights"
    ],

    "central": [
      "saddar",
      "numaish",
      "tariq road",
      "bahadurabad",
      "lalukhet",
      "liaquatabad",
      "nazimabad",
      "gulshan e iqbal",
      "gulshan",
      "gulistan e johar",
      "johar",
      "shahrah e faisal",
      "sharae faisal",
      "airport",
      "stadium road"
    ],

    "south": [
      "clifton",
      "dha",
      "defence",
      "seaview",
      "boat basin",
      "phase 1",
      "phase 2",
      "phase 5"
    ],

    "east": [
      "malir",
      "model colony",
      "korangi",
      "landhi",
      "quaidabad"
    ],

    "west": [
      "lyari",
      "baldia",
      "sher shah",
      "maripur"
    ]
  }
}
```

---

# 2. Distress Query Modules (Reusable blocks)

## A) Traffic / Road Block

```json
{
  "traffic": [
    "traffic jam",
    "road blocked",
    "road closed",
    "diversion",
    "heavy traffic",
    "blocked road",
    "route closed"
  ]
}
```

---

## B) Protest / Crowd events

```json
{
  "protest": [
    "protest",
    "dharna",
    "hartal",
    "rally",
    "muzahira",
    "sit-in",
    "road blocked due to protest"
  ]
}
```

---

## C) Infrastructure failure

```json
{
  "infrastructure": [
    "pipe burst",
    "water leakage",
    "sewer overflow",
    "gas leak",
    "electricity outage",
    "power failure"
  ]
}
```

---

## D) Weather disruption

```json
{
  "weather": [
    "rain",
    "heavy rain",
    "flood",
    "waterlogging",
    "storm",
    "urban flooding"
  ]
}
```

---

## E) Accidents

```json
{
  "accident": [
    "accident",
    "road accident",
    "collision",
    "bike crash",
    "car crash",
    "fatal crash"
  ]
}
```

---

# 3. Query Builder Templates (VERY IMPORTANT)

## Template format

```text
(LOCATION GROUP)
AND
(DISTRESS GROUP)
```

---

## Example builder function logic (JSON style)

```json
{
  "build_query": {
    "location": "(karachi OR dha OR clifton OR gulshan)",
    "distress": "(traffic OR protest OR accident)",
    "final": "(karachi OR dha OR clifton OR gulshan) AND (traffic OR protest OR accident)"
  }
}
```

---

# 4. READY-MADE API QUERIES (USE THESE DIRECTLY)

## 🔥 1. High Priority Traffic Alerts

```text
(karachi OR saddar OR numaish OR shahrah e faisal OR clifton OR dha OR gulshan)
AND
("road blocked" OR "traffic jam" OR diversion OR "road closed")
```

---

## 🔥 2. Protest / Road closure alerts

```text
(karachi OR korangi OR malir OR saddar OR gulshan OR clifton OR dha)
AND
(protest OR dharna OR hartal OR muzahira OR "sit-in")
```

---

## 🔥 3. Accidents (real-time risk alerts)

```text
(karachi OR shahrah e faisal OR tariq road OR korangi OR malir OR gulshan)
AND
(accident OR crash OR collision OR "road accident")
```

---

## 🔥 4. Flood / rain disruption

```text
(karachi OR malir OR korangi OR saddar OR gulshan OR clifton)
AND
(rain OR flooding OR waterlogging OR "urban flooding")
```

---

## 🔥 5. Infrastructure breakdown

```text
(karachi OR gulshan OR korangi OR clifton OR dha)
AND
("pipe burst" OR "gas leak" OR "electricity outage" OR "water shortage")
```

---

# 5. DATE FILTERING (APIDirect style)

From your API usage, date filtering is usually done via:

### Option A (if supported):

```text
since=2026-05-15
until=2026-05-16
```

---

### Option B (more common in social APIs like this)

You filter AFTER response:

```json
{
  "filter": {
    "last_24h": true,
    "last_7d": false,
    "custom_range": {
      "from": "2026-05-15",
      "to": "2026-05-16"
    }
  }
}
```

---

### Option C (query-based time hints)

Add to query:

```text
"today" OR "now" OR "breaking" OR "just happened"
```

Example:

```text
(karachi OR clifton OR dha)
AND
(traffic OR accident OR protest)
AND
("today" OR "breaking" OR "just now")
```

---

# 6. BEST PRACTICE (VERY IMPORTANT)

## ❌ Don’t rely on API filtering alone

It will always be noisy.

---

## ✅ Do this instead:

### Step 1: Broad API query

(get maximum coverage)

### Step 2: Backend filtering

* must contain Karachi location OR known area
* must contain distress keyword
* must have negative sentiment OR fear/anger/emotion spike

### Step 3: Scoring

```text
+5 location match
+4 distress keyword
+3 fear/anger emotion
+2 verified account or news source
```

---

# 7. If you want next upgrade (highly recommended)

I can help you build:

### 🧠 1. “Distress Detection Engine”

Turns posts into:

```json
{
  "severity": "high",
  "type": "traffic",
  "location": "Shahrah e Faisal",
  "confidence": 0.87
}
```

---

### 🗺️ 2. Live Karachi Heatmap system

---

### ⚡ 3. Streaming real-time alert system (like Uber surge alerts but for roads)

---

Just tell me 👍
