# با خبر

A real-time, multi-agent crisis intelligence and response orchestrator for instant civilian alerts.

## System Architecture

<img src="./flow dig.jpg" alt="با خبر multi-agent flow" width="100%" />

---

## Multi-Agent System Flow (Readable)

1. **Data enters با خبر**
   - Sources: unstructured feeds, bulk upload, and user-reported incidents.
2. **Coordinator receives each new event**
   - Normalizes raw input into structured incident context.
   - Chooses the next action path.
3. **Coordinator forwards to Triage Agent**
   - Triage classifies severity, category, and urgency.
   - Triage decides whether logistics support is needed.
4. **Decision gate: "Requires Logistics?"**
   - **Yes** -> Logistics Agent is invoked.
   - **No** -> event proceeds toward final merge.
5. **Logistics Agent actions (when invoked)**
   - Evaluates response feasibility and operational needs.
   - Suggests assets/dispatch guidance and improves response confidence.
   - Performs multi-source validation checks where applicable.
6. **Final merged event is stored**
   - Saved in persistence layer with summary, tags, source trail, and metadata.
7. **Consumers receive outputs**
   - Web dashboard displays operational feed.
   - Mobile app receives nearest/relevant alerts.
8. **Citizen loop closes back into با خبر**
   - User can report a new incident (Urdu/English/Roman Urdu + optional media).
   - That report re-enters the same Coordinator -> Triage -> (optional) Logistics flow.

---

## Agent Roles (Explicit)

### 1) Coordinator Agent
- Entry point for every event in با خبر.
- Converts raw input into structured incident context (topic, location, urgency signals).
- Decides the next route:
  - Standard incident -> Triage Agent
  - Direct operational need -> Logistics Agent (when required)
- Controls handoff logic and keeps the pipeline flow consistent.

### 2) Triage Agent
- Performs core incident understanding and risk analysis.
- Classifies incident type/category and assigns urgency/priority signals.
- Produces decision-ready context (summary + reasoning for downstream actions).
- Sets whether logistics escalation is needed (`requires_logistics`).

### 3) Logistics Agent
- Activated when the incident requires operational response support.
- Recommends deployment/asset guidance and action direction.
- Performs verification-oriented checks to reduce false positives where possible.
- Returns practical response outputs used by dashboard and alert flows.

---

## Antigravity Usage/Users/mustafa.munir/Personal/aegis-master/agy.mov


https://github.com/user-attachments/assets/d7c05fce-a56c-46b3-a24a-09c2cdeb02a3




Chats and artifacts:
- [antigravity-chats-and-artifacts](./antigravity-chats-and-artifacts/)

---

## Tools / APIs Used

- **Google Gemini API**: agent reasoning and structured decision outputs.
- **News API (via SerpAPI)**: live news signal ingestion and supporting evidence.
- **Weather API**: current + forecast weather context for event enrichment.
- **Social Media API (3rd party)**: social signal ingestion for incident intelligence.
- **Google Maps APIs**: geospatial context, coordinates, and map-linked incident relevance.
- **Supabase APIs**: persistent event storage, retrieval, and nearest/list query support.
- **Google Cloud Storage**: event/user image storage and public media URLs.

---

## Assumptions and Limitations

- We planned to run scans as scheduled jobs, but due to limited credentials this is currently disabled. With sufficient credentials, scans can run every 3 hours.
- Limited API access may restrict proper verification of user-reported incidents; paid APIs can improve this.
- With the free Gemini quota, scans in deployed environments may work only 1-2 times before quota limits are hit.
- The system is designed to handle multilingual reports.
- This agentic system is designed to work at any scale, so large datasets can be plugged into it for public-sector deployment and utilization.

---

made with ❤️ using Antigravity
