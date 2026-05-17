import { Application, Assets, Sprite } from "pixi.js";
import Swal from "sweetalert2";
import { clear, get, set } from "idb-keyval";

interface Egg {
  id: string;
  name: string;
  chance: number;
  price: number;
  src: string;
}

interface Instance {
  id: string;
  uuid: ReturnType<typeof crypto.randomUUID>;
  x: number;
  y: number;
}

interface Config {
  eggs: Egg[];
}

(async () => {
  const config: Config = {
    eggs: [
      {
        id: "brown",
        name: "brown eggs",
        chance: 50,
        price: 10,
        src: `/eggs/brown.png`,
      },
      {
        id: "white",
        name: "white eggs",
        chance: 50,
        price: 10,
        src: `/eggs/white.png`,
      },
      {
        id: "gold",
        name: "gold eggs",
        chance: 5,
        price: 30,
        src: `/eggs/gold.png`,
      },
      {
        id: "diamond",
        name: "diamond eggs",
        chance: 3,
        price: 60,
        src: `/eggs/diamond.png`,
      },
      {
        id: "rainbow",
        name: "rainbow eggs",
        chance: 1,
        price: 100,
        src: `/eggs/rainbow.png`,
      },
    ],
  };

  const app = new Application();

  await app.init({
    background: `#ffffff`,
    width: 0.7 * window.innerWidth, // 70%
    height: 0.95 * window.innerHeight, // 95%
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  document.body.appendChild(app.canvas);

  const selectEgg = () => {
    const totalWeight = config.eggs.reduce((acc, egg) => acc + egg.chance, 0);
    if (totalWeight === 0) return config.eggs[0];

    const randomRoll = Math.random() * totalWeight;
    let cursor = 0;

    for (const egg of config.eggs) {
      cursor += egg.chance;
      if (randomRoll < cursor) {
        return egg;
      }
    }

    // Fallback for extreme floating point errors
    return config.eggs[config.eggs.length - 1];
  };

  interface Stats {
    eggs: Record<string, number> & { total: number };
    money: number;
  }

  const stats: Stats = (await get("stats"))
    ? ((await get("stats")) as Stats)
    : {
        eggs: {
          total: 0,
          ...Object.fromEntries(config.eggs.map((e) => [e.id, 0])),
        },
        money: 0,
      };

  const instances: Set<Instance> = (await get("instances"))
    ? ((await get("instances")) as Set<Instance>)
    : new Set();

  const statsEl = document.querySelector(`#stats`) as HTMLDivElement;

  const updateTotal = () => {
    // Update the HTML
    for (const [id, val] of Object.entries(stats.eggs)) {
      const name =
        id === "total"
          ? `total eggs`
          : config.eggs.find((e) => e.id === id)?.name || `unknown eggs`;
      let el = statsEl.querySelector<HTMLDivElement>(
        `[data-type="${id.replace(/"/g, `\\"`)}"]`,
      );
      if (!el) {
        el = document.createElement("div");
        el.dataset.type = id;
        statsEl.appendChild(el);
      }

      el.textContent = `${val} ${name}!`;
    }

    {
      let el = statsEl.querySelector<HTMLDivElement>(`[data-type="money"]`);
      if (!el) {
        el = document.createElement("div");
        el.dataset.type = "money";
        statsEl.appendChild(el);
      }
      el.textContent = `$${stats.money}!`;
    }
  };

  updateTotal(); // Initialize the counters

  const makeEgg = async (e: KeyboardEvent | MouseEvent) => {
    if (e.type === "click" || ("code" in e && e.code === "KeyE")) {
      // Generate random positions
      const egg = selectEgg();
      const texture = await Assets.load(egg.src);
      const sprite = new Sprite(texture);

      sprite.anchor.set(0.5);

      const minX = sprite.width / 2;
      const maxX = app.screen.width - sprite.width / 2;

      const minY = sprite.height / 2;
      const maxY = app.screen.height - sprite.height / 2;

      sprite.x = Math.random() * (maxX - minX) + minX;
      sprite.y = Math.random() * (maxY - minY) + minY;

      const instance = {
        id: egg.id,
        uuid: crypto.randomUUID(),
        x: sprite.x,
        y: sprite.y,
      };

      instances.add(instance);

      sprite.eventMode = "static";
      sprite.on("click", () => {
        sprite.destroy();
        stats.eggs.total--;
        stats.eggs[egg.id]--;
        stats.money += egg.price;
        instances.delete(instance);
        updateTotal();
      });

      stats.eggs.total++;
      stats.eggs[egg.id]++;
      updateTotal();

      app.stage.addChild(sprite);
    }
  };

  document.addEventListener("keyup", makeEgg);
  {
    const el = document.querySelector(`#generate-egg`) as HTMLButtonElement;
    el.addEventListener("click", makeEgg);
  }

  // Load saved instances
  if (instances.size > 0) {
    for (const instance of instances) {
      const egg = config.eggs.find((e) => e.id === instance.id);

      if (!egg) continue;

      const texture = await Assets.load(egg.src);
      const sprite = new Sprite(texture);

      sprite.anchor.set(0.5);

      sprite.x = instance.x;
      sprite.y = instance.y;

      sprite.eventMode = "static";
      sprite.on("click", () => {
        sprite.destroy();
        stats.eggs.total--;
        stats.eggs[egg.id]--;
        stats.money += egg.price;
        instances.delete(instance);
        updateTotal();
      });

      app.stage.addChild(sprite);
    }
  }

  // Game saving
  const saveGame = async () => {
    const el = document.querySelector(`#save-msg`) as HTMLDivElement;
    el.style.display = "revert";

    setTimeout(() => (el.style.display = "none"), 5000);

    await set("stats", stats);
    await set("instances", instances);
  };

  const wipeSave = async () => {
    const result = await Swal.fire({
      title: `Are you sure?`,
      icon: "question",
      text: `This action is permanent and cannot be undone!`,
      showCancelButton: true,
    });

    if (result.isConfirmed) {
      const result = await Swal.fire({
        title: `Are you really sure?`,
        icon: "question",
        text: `This action is permanent and cannot be undone! Don't take this lightly!`,
        showCancelButton: true,
      });

      if (result.isConfirmed) {
        await clear();
        location.reload();
      }
    }
  };

  {
    const el = document.querySelector(`#save-game`) as HTMLButtonElement;
    el.addEventListener("click", saveGame);
    setInterval(saveGame, 15000);
  }

  {
    const el = document.querySelector(`#wipe-save`) as HTMLButtonElement;
    el.addEventListener("click", wipeSave);
  }
})();
