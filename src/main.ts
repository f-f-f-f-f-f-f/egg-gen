import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import Swal from "sweetalert2";
import { clear, get, set } from "idb-keyval";

interface Egg {
  id: string;
  name: string;
  chance: number;
  price: number;
  src: string;
}

interface Mutation {
  id: string;
  name: string;
  chance: number;
  type: "positive" | "neutral" | "negative" | "variable";
  effect: number | ((egg: Egg) => number | Promise<number>);
}

interface Instance {
  id: string;
  mutation: string;
  x: number;
  y: number;
}

interface Setting {
  id: string;
  name: string;
  desc?: string;
  type: "checkbox" | "text";
  default?: string | number | boolean;
  onChange: (el: HTMLInputElement) => void | Promise<void>;
}

interface SettingOption {
  id: string;
  val: string | number | boolean;
}

interface Config {
  eggs: Egg[];
  mutations: Mutation[];
}

(async () => {
  const base = import.meta.env.BASE_URL;

  const config: Config = {
    eggs: [
      {
        id: "brown",
        name: "brown eggs",
        chance: 50,
        price: 10,
        src: `eggs/brown.png`,
      },
      {
        id: "white",
        name: "white eggs",
        chance: 50,
        price: 10,
        src: `eggs/white.png`,
      },
      {
        id: "gold",
        name: "gold eggs",
        chance: 5,
        price: 30,
        src: `eggs/gold.png`,
      },
      {
        id: "diamond",
        name: "diamond eggs",
        chance: 3,
        price: 60,
        src: `eggs/diamond.png`,
      },
      {
        id: "rainbow",
        name: "rainbow eggs",
        chance: 1,
        price: 100,
        src: `eggs/rainbow.png`,
      },
    ].map((e) => ({ ...e, src: `${base}${e.src}` })),

    mutations: [
      {
        id: "none",
        name: "None",
        chance: 80,
        type: "neutral",
        effect: 1.0,
      },
      {
        id: "big",
        name: "Big",
        chance: 30,
        type: "positive",
        effect: 1.2,
      },
      {
        id: "double-yolk",
        name: "Double Yolk",
        chance: 5,
        type: "positive",
        effect: 2, // Double the yolk, so double the price!
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
    preference: (await get("noGpu")) ? "canvas" : undefined,
  });

  document.body.appendChild(app.canvas);

  app.stage.sortableChildren = true;

  // Mutation tooltip
  const mutationTooltip = {
    container: new Container(),
    text: new Text({
      text: "",
      style: {
        fontFamily: "Verdana",
        fill: 0xffffff,
        fontSize: 14,
      },
    }),
    bg: new Graphics(),
    offset: {
      x: 15,
      y: 15,
      padding: 8,
    },
    init() {
      this.container.visible = false;
      this.container.zIndex = 1000;
      this.container.addChild(this.bg, this.text);

      app.stage.addChild(this.container);
    },

    /** Use in the `pointerover` event */
    onPointerOver(
      event: FederatedPointerEvent,
      mutation: Mutation,
      price: number,
    ) {
      this.text.text = `${mutation.name} ($${price})`;
      this.text.x = this.offset.padding;
      this.text.y = this.offset.padding;

      const color = (() => {
        switch (mutation.type) {
          case "neutral": {
            return "white";
          }

          case "positive": {
            return "lawngreen";
          }

          case "negative": {
            return "red";
          }

          case "variable": {
            return "yellow";
          }
        }
      })();
      this.text.style.fill = color;

      const width = this.text.width + this.offset.padding * 2;
      const height = this.text.height + this.offset.padding * 2;

      this.bg.clear();
      this.bg.fill({ color: 0x515157 });
      this.bg.roundRect(0, 0, width, height, 4);
      this.bg.stroke({ color, width: 4 });
      this.bg.fill();

      this.container.x = event.global.x + this.offset.x;
      this.container.y = event.global.y + this.offset.y;

      this.container.visible = true;
    },

    /** Use in the `pointermove` event */
    onPointerMove(event: FederatedPointerEvent) {
      if (this.container.visible) {
        this.container.x = event.global.x + this.offset.x;
        this.container.y = event.global.y + this.offset.y;
      }
    },

    /** Use in the `pointerout` event, and also call this right before destroying the egg sprite */
    onPointerOut() {
      this.container.visible = false;
    },
  };

  mutationTooltip.init();

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

  const selectMutation = () => {
    const totalWeight = config.mutations.reduce(
      (acc, egg) => acc + egg.chance,
      0,
    );
    if (totalWeight === 0) return config.mutations[0];

    const randomRoll = Math.random() * totalWeight;
    let cursor = 0;

    for (const mutation of config.mutations) {
      cursor += mutation.chance;
      if (randomRoll < cursor) {
        return mutation;
      }
    }

    // Fallback for extreme floating point errors
    return config.mutations[config.mutations.length - 1];
  };

  interface Stats {
    eggs: Record<string, number> & { total: number };
    money: number;
  }

  const stats: Stats = {
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

  const makeEgg = async (
    e: KeyboardEvent | MouseEvent,
    precreatedInstance?: Instance,
  ) => {
    if (e.type === "click" || ("code" in e && e.code === "KeyE")) {
      // Generate random positions
      const egg =
        config.eggs.find((e) => e.id === precreatedInstance?.id) || selectEgg();
      const mutation =
        config.mutations.find((e) => e.id === precreatedInstance?.mutation) ||
        selectMutation();
      const price =
        typeof mutation.effect === "number"
          ? egg.price * mutation.effect
          : egg.price * (await mutation.effect(egg));
      const texture = await Assets.load(egg.src);
      const sprite = new Sprite(texture);

      sprite.anchor.set(0.5);

      const minX = sprite.width / 2;
      const maxX = app.screen.width - sprite.width / 2;

      const minY = sprite.height / 2;
      const maxY = app.screen.height - sprite.height / 2;

      sprite.x = precreatedInstance?.x || Math.random() * (maxX - minX) + minX;
      sprite.y = precreatedInstance?.y || Math.random() * (maxY - minY) + minY;

      const instance = precreatedInstance || {
        id: egg.id,
        x: sprite.x,
        y: sprite.y,
        mutation: mutation.id,
      };

      instances.add(instance);

      sprite.eventMode = "static";
      sprite.on("pointertap", () => {
        sprite.destroy();
        stats.eggs.total--;
        stats.eggs[egg.id]--;
        stats.money += price;
        instances.delete(instance);
        mutationTooltip.onPointerOut();
        updateTotal();
      });

      sprite.on("pointerover", (e) => {
        mutationTooltip.onPointerOver(e, mutation, price);
      });

      sprite.on("pointermove", (e) => {
        mutationTooltip.onPointerMove(e);
      });

      sprite.on("pointerout", () => {
        mutationTooltip.onPointerOut();
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
      await makeEgg(new MouseEvent("click"), instance);
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

  let autoSaveId: number;
  {
    const el = document.querySelector(`#save-game`) as HTMLButtonElement;
    el.addEventListener("click", saveGame);
    autoSaveId = setInterval(saveGame, 15000);
  }

  {
    const el = document.querySelector(`#wipe-save`) as HTMLButtonElement;
    el.addEventListener("click", wipeSave);
  }

  // Settings
  {
    const settings: Setting[] = [
      {
        id: "autosave",
        name: "Autosave",
        type: "checkbox",
        default: true,
        onChange(el) {
          if (!el.checked) {
            clearInterval(autoSaveId);
          } else {
            autoSaveId = setInterval(saveGame, 15000);
          }
        },
      },
      {
        id: "gpu",
        name: `Use Hardware Acceleration`,
        type: "checkbox",
        default: true,
        desc: `Disable hardware acceleration.
The game will save and restart once you change this.`,
        async onChange(el) {
          if (el.checked) {
            await set("noGpu", false);
            await saveGame();
            location.reload();
          } else {
            await set("noGpu", true);
            await saveGame();
            location.reload();
          }
        },
      },
    ];

    const settingOptions: SettingOption[] = (await get("settings"))
      ? ((await get("settings")) as SettingOption[])
      : settings.map((s) => ({
          id: s.id,
          val:
            s.type === "checkbox"
              ? s.default
                ? true
                : false
              : s.default
                ? s.default
                : "",
        }));

    const btn = document.querySelector(`#settings-btn`) as HTMLButtonElement;
    const menu = document.querySelector(`#settings-menu`) as HTMLDialogElement;

    for (const setting of settings) {
      const option = settingOptions.find((s) => s.id === setting.id)!;

      const div = document.createElement("div");
      div.textContent = setting.name;

      const input = document.createElement("input");
      input.style.margin = "10px 10px";
      if (setting.type === "checkbox") {
        input.type = "checkbox";
        input.checked = Boolean(option.val);
        input.addEventListener("change", async () => {
          option.val = input.checked;
          await setting.onChange(input);
          await set("settings", settingOptions);
        });
      } else if (setting.type === "text") {
        input.type = "text";
        input.value = String(option.val);
        input.addEventListener("change", async () => {
          option.val = input.value;
          await setting.onChange(input);
          await set("settings", settingOptions);
        });
      }
      div.appendChild(input);

      if (setting.desc) {
        const mark = document.createElement("span");
        mark.textContent = "?";
        mark.style.border = `2px solid black`;
        mark.style.padding = "2px 6px";
        mark.style.borderRadius = "50%";
        mark.style.cursor = "pointer";
        mark.style.backgroundColor = "white";
        div.appendChild(mark);

        const desc = document.createElement("div");
        desc.textContent = setting.desc;
        desc.style.overflowWrap = "break-word";
        desc.style.backgroundColor = "gainsboro";
        desc.style.border = "2px solid black";
        desc.style.display = "none";
        desc.style.position = "absolute";
        desc.style.whiteSpace = "pre-wrap";
        desc.style.padding = "5px";
        document.body.appendChild(desc);

        mark.addEventListener("mouseenter", (e) => {
          desc.style.left = `${e.pageX + 30}px`;
          desc.style.top = `${e.pageY + 30}px`;
          desc.style.display = "revert";
        });

        mark.addEventListener("mousemove", (e) => {
          desc.style.left = `${e.pageX + 30}px`;
          desc.style.top = `${e.pageY + 30}px`;
          desc.style.display = "revert";
        });

        mark.addEventListener("mouseleave", () => {
          desc.style.display = "none";
        });
      }

      menu.appendChild(div);
    }

    btn.addEventListener("click", () => {
      menu.showModal();
    });

    const cheatMode = () => {
      return {
        makeEgg,
        settings,
        updateTotal,
        config,
        selectEgg,
        selectMutation,
        saveGame,
        wipeSave,
      };
    };

    (window as any).Gulcheat = cheatMode;
    (window as any).cheatGul = async () => {
      alert(`Guess you didn't realize the 'Gul' stood for gullible!`);
      alert(
        `Also go fuck yourself, but preserve some of your dignity by playing this game:\nhttps://jjohnstongames.itch.io/the-roottrees-are-dead`,
      );
      await saveGame();
      window.open("", "_self")?.close();
    };

    console.log(
      `[=== Ready to cheat in some eggs or just checking around? ===]`,
    );
    console.log(
      `[=== psst if youre choosing the first option type in window.cheatGul() and press Enter ===]`,
    );
  }
})();
