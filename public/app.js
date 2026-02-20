async function load() {
  const el = document.getElementById("app");
  el.innerHTML = "Loading...";

  try {
    const res = await fetch("/api/track?sport=nba");
    const data = await res.json();

    el.innerHTML = "";

    data.forEach(game => {
      const div = document.createElement("div");
      div.className = "card";
      div.textContent = `${game.home} ${game.homeScore} - ${game.awayScore} ${game.away}`;
      el.appendChild(div);
    });

  } catch {
    el.innerHTML = "Failed to load.";
  }
}

setInterval(load, 5000);
load();
