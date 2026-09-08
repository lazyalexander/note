/* Adapted from EmirXK/bad_apple (MIT) — ASCII Bad Apple player */
(function () {
  "use strict";

  const fps = 30;
  const frameDuration = 1000 / fps;
  const asciiDisplay = document.getElementById("ascii-display");
  const audioPlayer = document.getElementById("audio-player");
  const playButton = document.getElementById("play-button");
  const statusEl = document.getElementById("ba-status");
  if (!asciiDisplay || !audioPlayer || !playButton) return;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function framesUrl() {
    var a = document.createElement("a");
    a.href = "assets/bad-apple/framesData.lz";
    return a.href;
  }

  setStatus("loading frames…");
  fetch(framesUrl())
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    })
    .then(function (data) {
      if (typeof LZString === "undefined") throw new Error("LZString missing");
      var decompressed = LZString.decompressFromBase64(data);
      var framesData = JSON.parse(decompressed);
      setStatus("ready — press play");
      init(framesData);
    })
    .catch(function (err) {
      console.error(err);
      setStatus("failed to load frames: " + (err && err.message ? err.message : err));
    });

  function init(framesData) {
    function adjustFont() {
      var box = asciiDisplay.parentElement || asciiDisplay;
      var w = box.clientWidth || window.innerWidth;
      var fontSize = Math.max(4, Math.min(14, w / 72));
      asciiDisplay.style.fontSize = fontSize + "px";
    }
    adjustFont();
    window.addEventListener("resize", adjustFont);

    playButton.addEventListener("click", function () {
      playButton.disabled = true;
      playButton.style.display = "none";
      setStatus("playing");
      audioPlayer.load();
      setTimeout(function () {
        var p = audioPlayer.play();
        if (p && p.catch) p.catch(function () {});
        playAnimation(framesData);
      }, 200);
    });
  }

  function playAnimation(framesData) {
    var startTime = performance.now();
    function renderFrame() {
      var expected = Math.floor((performance.now() - startTime) / frameDuration);
      if (expected < framesData.length) {
        asciiDisplay.textContent = String(framesData[expected]).replace(/\\n/g, "\n");
        requestAnimationFrame(renderFrame);
      } else {
        asciiDisplay.textContent = String(framesData[framesData.length - 1]).replace(
          /\\n/g,
          "\n"
        );
        setStatus("end");
      }
    }
    renderFrame();
  }
})();
