(function() {
  let capturedOrder = null;
  let lastSentOrder = null;
  let lastSortMode = null;
  let isFirstRun = true;

  const normalizeSortMode = (value) => {
    const mode = parseInt(value, 10);
    return Number.isFinite(mode) ? mode : 0;
  };
  const isSortMode = (value) => {
    const mode = normalizeSortMode(value);
    return mode === 1 || mode === 2;
  };

  const normalizeLeaderboard = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const itemKey = (item) => {
    if (!item || typeof item !== "object") return "";
    if (item.name !== undefined && item.name !== null) return String(item.name);
    if (item.id !== undefined && item.id !== null) return String(item.id);
    return "";
  };

  const captureOrder = (items) => items.map(itemKey).filter(key => key !== "");

  const keepOrder = (items, order) => {
    const orderToUse = order || captureOrder(items);

    const remaining = [...items];
    const ordered = [];

    orderToUse.forEach((key) => {
      const index = remaining.findIndex(item => itemKey(item) === key);
      if (index !== -1) ordered.push(remaining.splice(index, 1)[0]);
    });

    ordered.push(...remaining);
    return ordered;
  };

  return {
    init: function(comp, context) {
      const riveWidget = comp.findWidget("Rive")[0];

      const updateLeaderboard = function() {
        const payload = comp.getPayload2();
        const leaderboardData = normalizeLeaderboard(payload.Leaderboard);
        const currentSortMode = payload.Sort;
        const currentSortType = normalizeSortMode(currentSortMode);

        if (isFirstRun) {
          isFirstRun = false;

          if (riveWidget) {
            riveWidget.setPayload({
              "listProperty": leaderboardData,
              "sortType": 0
            });
          }
          lastSentOrder = captureOrder(leaderboardData);

          if (isSortMode(currentSortMode)) {
            capturedOrder = lastSentOrder;
            setTimeout(() => {
              if (riveWidget) {
                riveWidget.setPayload({ "sortType": currentSortType });
              }
            }, 100);
          }

          lastSortMode = currentSortMode;
          return;
        }

        if (isSortMode(currentSortMode) && !isSortMode(lastSortMode)) {
          capturedOrder = lastSentOrder || captureOrder(leaderboardData);
        }

        let dataForWidget;
        if (isSortMode(currentSortMode)) {
          dataForWidget = keepOrder(leaderboardData, capturedOrder || lastSentOrder);
          capturedOrder = captureOrder(dataForWidget);
        } else {
          dataForWidget = leaderboardData;
          capturedOrder = null;
        }

        lastSentOrder = captureOrder(dataForWidget);

        if (riveWidget) {
          riveWidget.setPayload({
            "listProperty": dataForWidget,
            "sortType": currentSortType
          });
        }

        lastSortMode = currentSortMode;
      };

      comp.addListener('payload_changed', (event, msg, e) => {
        if (msg.compositionId === comp.id) {
          updateLeaderboard();
        }
        e.stopPropagation();
      });

      updateLeaderboard();
    },

    close: function(comp, context) {
      capturedOrder = null;
      lastSentOrder = null;
      lastSortMode = null;
      isFirstRun = true;
    }
  };
})();
