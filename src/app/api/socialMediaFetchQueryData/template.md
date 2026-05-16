
## Query Builder Templates (VERY IMPORTANT)
### Template format

```text
(LOCATION GROUP)
AND
(DISTRESS GROUP)
```

---

### Example builder function logic (JSON style)

```json
{
  "build_query": {
    "location": "(karachi OR dha OR clifton OR gulshan)",
    "distress": "(traffic OR protest OR accident)",
    "final": "(karachi OR dha OR clifton OR gulshan) AND (traffic OR protest OR accident)"
  }
}
```

## READY-MADE API QUERIES (USE THESE DIRECTLY)

### 🔥 1. High Priority Traffic Alerts

```text
(karachi OR saddar OR numaish OR shahrah e faisal OR clifton OR dha OR gulshan)
AND
("road blocked" OR "traffic jam" OR diversion OR "road closed")
```

---

### 🔥 2. Protest / Road closure alerts

```text
(karachi OR korangi OR malir OR saddar OR gulshan OR clifton OR dha)
AND
(protest OR dharna OR hartal OR muzahira OR "sit-in")
```

---

### 🔥 3. Accidents (real-time risk alerts)

```text
(karachi OR shahrah e faisal OR tariq road OR korangi OR malir OR gulshan)
AND
(accident OR crash OR collision OR "road accident")
```

---

### 🔥 4. Flood / rain disruption

```text
(karachi OR malir OR korangi OR saddar OR gulshan OR clifton)
AND
(rain OR flooding OR waterlogging OR "urban flooding")
```

---

### 🔥 5. Infrastructure breakdown

```text
(karachi OR gulshan OR korangi OR clifton OR dha)
AND
("pipe burst" OR "gas leak" OR "electricity outage" OR "water shortage")
```
