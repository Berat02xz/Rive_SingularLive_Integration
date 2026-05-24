(function() {
  let capturedOrder = null;
  let lastSortMode = null;
  let isFirstRun = true;  // NEW: tracks the very first updateLeaderboard call

  return {
    init: function(comp, context) {
      const riveWidget = comp.findWidget("Rive")[0];

      const updateLeaderboard = function() {
        const payload = comp.getPayload2();
        const leaderboardData = payload.Leaderboard || [];
        const currentSortMode = payload.Sort;

        // -----------------------------------------------------------------
        // FIRST-RUN HANDLING
        // On initial load, Singular has already sorted leaderboardData based
        // on the Sort control. If we sent that pre-sorted data straight to
        // the widget, the Rive Lua script would record the sorted order as
        // "originalOrder" — so switching back to Sort=0 later would restore
        // the sorted order (i.e. the list looks reversed for Sort=1).
        //
        // Workaround: on the first run, pretend Sort=0 — send the data with
        // sortType=0 so the Rive script captures the authored order, then
        // schedule the real Sort value to be applied a tick later.
        // -----------------------------------------------------------------
        if (isFirstRun) {
          isFirstRun = false;

          // Phase 1: force Sort=0 in the widget so originalOrder is captured
          //          in the order Singular hands us the data on first load.
          if (riveWidget) {
            riveWidget.setPayload({
              "listProperty": leaderboardData,
              "sortType": 0
            });
          }

          // Phase 2: a short delay later, apply the actual Sort the user has
          //          selected. The Rive Lua script will sort but keep the
          //          originalOrder snapshot from phase 1 intact, so going
          //          back to Sort=0 later will restore the authored order.
          if (currentSortMode === '1' || currentSortMode === '2') {
            // Pre-capture the order before phase 2, mirroring the normal
            // 0 → 1/2 transition logic below.
            capturedOrder = leaderboardData.map(item => item.name);
            setTimeout(() => {
              if (riveWidget) {
                riveWidget.setPayload({
                  "sortType": parseInt(currentSortMode, 10)
                });
              }
            }, 100);
          }

          lastSortMode = currentSortMode;
          return;
        }

        // -----------------------------------------------------------------
        // NORMAL (post-first-run) BEHAVIOR — unchanged from your original
        // -----------------------------------------------------------------
        if ((currentSortMode === '1' || currentSortMode === '2') && (lastSortMode === '0' || lastSortMode === null)) {
          capturedOrder = leaderboardData.map(item => item.name);
        }

        if (currentSortMode === '0') {
          capturedOrder = null;
        }

        let dataForWidget;

        if (capturedOrder) {
          const sourceData = [...leaderboardData];
          dataForWidget = capturedOrder.map(name => {
            const index = sourceData.findIndex(item => item.name === name);
            if (index !== -1) {
              const item = sourceData.splice(index, 1)[0];
              return item;
            }
            return null;
          }).filter(item => item !== null);
        } else {
          dataForWidget = leaderboardData;
        }

        console.log("Updating listProperty on Rive widget.");
        console.log("Saved state (capturedOrder):", JSON.stringify(capturedOrder, null, 2));
        console.log("New state sent to listProperty:", JSON.stringify(dataForWidget, null, 2));

        if (riveWidget) {
          riveWidget.setPayload({
            "listProperty": dataForWidget
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
      lastSortMode = null;
      isFirstRun = true;  // reset for next mount
    }
  };
})();
