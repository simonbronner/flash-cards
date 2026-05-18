const STORAGE_KEYS = {
  SELECTED_SETS: 'fc_selected_sets',
  CARD_STATS: 'fc_card_stats'
};

export const getSelectedSets = () => {
  const data = localStorage.getItem(STORAGE_KEYS.SELECTED_SETS);
  return data ? JSON.parse(data) : [];
};

export const setSelectedSets = (sets) => {
  localStorage.setItem(STORAGE_KEYS.SELECTED_SETS, JSON.stringify(sets));
};

export const getCardStats = () => {
  const data = localStorage.getItem(STORAGE_KEYS.CARD_STATS);
  return data ? JSON.parse(data) : {};
};

export const updateCardStat = (cardId, quality) => {
  const stats = getCardStats();
  const cardStat = stats[cardId] || {
    repetition: 0,
    interval: 0,
    easeFactor: 2.5,
    nextReview: 0
  };

  // SM-2 Algorithm
  let { repetition, interval, easeFactor } = cardStat;

  if (quality >= 3) {
    if (repetition === 0) {
      interval = 1;
    } else if (repetition === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetition += 1;
  } else {
    repetition = 0;
    interval = 1;
  }

  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;

  stats[cardId] = {
    repetition,
    interval,
    easeFactor,
    nextReview
  };

  localStorage.setItem(STORAGE_KEYS.CARD_STATS, JSON.stringify(stats));
  return stats[cardId];
};

export const getSessionCards = (allCards, limit = 20) => {
  const stats = getCardStats();
  const now = Date.now();

  const scoredCards = allCards.map(card => {
    const stat = stats[card.id];
    let priority = 0;
    
    if (!stat) {
      priority = 100; // New cards
    } else if (stat.nextReview <= now) {
      priority = 200; // Due cards
    } else {
      priority = 0; // Not due yet
    }
    
    return { ...card, priority };
  });

  const selected = scoredCards
    .sort((a, b) => b.priority - a.priority || Math.random() - 0.5)
    .slice(0, limit);

  return selected.sort(() => Math.random() - 0.5);
};
