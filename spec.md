# Flash Card App Specification

## Objective
Build a free, data-driven React Single Page Application (SPA) for flashcard learning. The app will use a simple Spaced Repetition System (SRS) to optimize learning and track progress locally in the browser, with sessions tailored to 10-14 year olds (20 cards per session).

## Scope & Impact
- **Data Source:** JSON files hosted publicly (`public/data/*.json`).
- **State:** Browser `localStorage` for tracking progress and user preferences.
- **Algorithm:** SuperMemo-2 (SM-2) inspired algorithm prioritizing challenging cards while spacing out known cards.
- **Hosting:** Suitable for free hosting on Cloudflare Pages or GitHub Pages (no backend required).

## Proposed Solution

### 1. Data Schema
A base set for Times Tables (1-12) will be created as `public/data/timetables.json`.

```json
{
  "id": "timetables",
  "title": "Times Tables (1-12)",
  "description": "Master your multiplication tables.",
  "cards": [
    { "id": "tt-1x1", "front": "1 x 1", "back": "1" },
    { "id": "tt-1x2", "front": "1 x 2", "back": "2" }
    // ... up to 12x12
  ]
}
```

We will also need an index file `public/data/index.json` to list available sets.
```json
[
  { "id": "timetables", "title": "Times Tables (1-12)", "url": "/data/timetables.json" }
]
```

### 2. State Management (localStorage)
The app will maintain the following in `localStorage`:
- `learning_sets`: Array of selected set IDs (e.g., `["timetables"]`).
- `learning_stats`: An object tracking the SRS state for each card.
  ```json
  {
    "tt-1x1": {
      "interval": 0,       // Days until next review
      "repetition": 0,     // Consecutive correct answers
      "easeFactor": 2.5,   // Multiplier for spacing
      "nextReview": 1700000000000 // Timestamp
    }
  }
  ```

### 3. Session Logic
- **Target Size:** 20 cards per session.
- **Selection:**
  1. Fetch all cards from the selected `learning_sets`.
  2. Filter for cards where `nextReview` is due (less than or equal to current time) or undefined (new cards).
  3. Sort by priority (due cards first, then new cards).
  4. Select the top 20 cards.
  5. Shuffle the selected 20 cards to prevent order memorization.

### 4. Implementation Steps
1. **Data Creation:** Generate the `timetables.json` (144 cards) and `index.json`.
2. **Core Services:** Create `src/services/storage.js` for handling `localStorage` and the SRS algorithm.
3. **Components:**
   - `SetSelector`: UI to fetch `index.json` and let users select sets.
   - `SessionManager`: Handles assembling the 20-card session.
   - `FlashCard`: The visual card component (flippable).
   - `Controls`: Buttons for "Wrong", "Correct" (mapping to SRS outcomes).
   - `Dashboard`: View progress/stats.
4. **App Integration:** Wire components together in `App.jsx`.

### 5. Voice Recognition (Web Speech API)
- **Integration:** Use the native `window.SpeechRecognition` (or `webkitSpeechRecognition`) API to listen for the user's answer when a card is presented.
- **Microphone Access:** A toggle or button will be added to the UI to request microphone permission and enable "Voice Mode".
- **Matching Logic:** 
  - The spoken transcript will be compared against the `card.back` value.
  - To handle numeric answers (like times tables), the matching logic must be somewhat forgiving (e.g., matching "twelve" to "12", ignoring spaces/punctuation, and converting strings to lowercase).
- **Auto-Score Behavior:** If the transcript matches the correct answer:
  1. The card automatically flips to reveal the answer.
  2. The app automatically scores the card as "Correct" (quality = 4).
  3. The app advances to the next card after a brief delay (e.g., 1-1.5 seconds) so the user can see they got it right.
  - If the answer is incorrect or not recognized, it relies on the user to manually flip and score via the buttons.

## Verification & Testing
- Verify that selecting a set successfully loads the JSON.
- Verify that a session exactly contains up to 20 cards.
- Verify that clicking "Wrong" or "Correct" updates `localStorage` with the correct next review time.
- Verify the app works after a page refresh (state persistence).
- Verify that "Voice Mode" can be enabled and successfully requests microphone permissions.
- Verify that speaking the correct numeric answer (e.g., "twelve" for "12") triggers the auto-flip and auto-score logic.
