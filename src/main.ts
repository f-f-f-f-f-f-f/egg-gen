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
import { marked } from "marked";
import "driver.js/dist/driver.css";
import { driver } from "driver.js";

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
  onChange?: (el: HTMLInputElement) => void | Promise<void>;
  onLoad?: (el: HTMLInputElement) => void | Promise<void>;
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

  /** Both are inclusive. */
  function random(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  class Alert {
    el: HTMLDialogElement;

    constructor(
      public title: string,
      public msg: string,
      public encodeMode: "text" | "html" | "markdown" = "text",
      public disableClose: boolean = false,
      public setStyles: boolean = true,
    ) {
      const el = document.querySelector("#temp-alert-dialog")
        ? document.querySelector<HTMLDialogElement>("#temp-alert-dialog")!
        : Object.assign(document.createElement("dialog"), {
            id: "temp-alert-dialog",
          });

      this.el = el;

      if (this.setStyles) {
        el.style.cssText = `
background-color: gray;
color: white;
padding: 20px;
text-align: center;
align-content: center;
border: 5px solid black;
border-radius: 15px;
display: revert;
white-space: pre-wrap;
position: relative;
`
          .trim()
          .replace(/\n/g, "");
      }

      if (this.encodeMode === "html") {
        this.reset();
        this.el.innerHTML = `<h1>${title}</h1><div>${msg}</div>`;
      } else if (this.encodeMode === "markdown") {
        this.reset();
        const h1 = document.createElement("h1");
        h1.innerHTML = marked(title) as string;

        const div = document.createElement("div");
        div.innerHTML = marked(msg) as string;

        this.el.appendChild(h1);
        this.el.appendChild(div);
      } else if (this.encodeMode === "text") {
        this.reset();
        const h1 = document.createElement("h1");
        h1.textContent = title;

        const div = document.createElement("div");
        div.textContent = msg;

        this.el.appendChild(h1);
        this.el.appendChild(div);
      }

      if (this.disableClose) {
        this.el.addEventListener("cancel", (e) => {
          e.preventDefault();
        });
      } else {
        const btn = document.createElement("button");
        btn.textContent = `\u00D7`; // multiplication sign

        // prettier-ignore
        btn.style.cssText =
`
position: absolute;
top: 5px;
right: 10px;
border: 1px solid white;
cursor: pointer;
background-color: red;
width: 1.25rem;
height: 1.25rem;
display: flex;
align-items: center;
justify-content: center;
line-height: 0;
font-size: 1rem;
color: white;
`;

        btn.addEventListener("click", () => this.el.close());

        this.el.appendChild(btn);
      }

      document.body.prepend(this.el);

      this.el.showModal();
    }

    reset() {
      this.el.innerHTML = "";
    }

    close() {
      this.el.close();
    }
  }

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
        chance: 15,
        type: "positive",
        effect: 2, // Double the yolk, so double the price!
      },
      {
        id: "Cracked",
        name: "Cracked",
        chance: 5,
        type: "negative",
        effect: 0.5,
      },
      {
        id: "poison",
        name: "Poisoned",
        chance: 3,
        type: "negative",
        effect: -1,
      },
      {
        id: "pasture",
        name: "Pasture Raised",
        chance: 7,
        type: "positive",
        effect: 1.8,
      },
      {
        id: "free-range",
        name: "Free Range",
        chance: 30,
        type: "positive",
        effect: 1.5,
      },
      {
        id: "infected",
        name: "Infected",
        chance: 30,
        type: "negative",
        effect: -0.7,
      },
      {
        id: "unlucky",
        name: "Unlucky",
        chance: 30,
        type: "negative",
        effect: 0.9,
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

  document.querySelector("#pixi-container")!.appendChild(app.canvas);

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
    // Nudge the chances with the credit score
    const eggs = config.eggs.map((e) => {
      let chance = e.chance;
      if (stats.creditScore < 580 && chance < 50) {
        chance -= random(5, 15);
      } else if (stats.creditScore > 700 && chance < 50) {
        chance += random(5, 15);
      }

      return { ...e, chance };
    });

    const totalWeight = eggs.reduce((acc, egg) => acc + egg.chance, 0);
    if (totalWeight === 0) return eggs[0];

    const randomRoll = Math.random() * totalWeight;
    let cursor = 0;

    for (const egg of eggs) {
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
    creditScore: number;
  }

  const stats: Stats = {
    eggs: {
      total: 0,
      ...Object.fromEntries(config.eggs.map((e) => [e.id, 0])),
    },
    money: 0,
    creditScore: 640,
  };

  {
    // Load the credit score
    {
      const score = (await get("stats"))?.creditScore;
      if (score) stats.creditScore = score;
    }

    // Load the money
    {
      const money = (await get("stats"))?.money;
      if (money) stats.money = money;
    }
  }

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

    {
      let el = statsEl.querySelector<HTMLDivElement>(
        `[data-type="credit-score"]`,
      );
      if (!el) {
        el = document.createElement("div");
        el.dataset.type = "credit-score";
        statsEl.appendChild(el);
      }
      el.textContent = `Credit Score: ${stats.creditScore}!`;
    }
  };

  updateTotal(); // Initialize the counters

  let alertedDebt = false;

  const makeEgg = async (precreatedInstance?: Instance) => {
    // Generate random positions
    const egg =
      config.eggs.find((e) => e.id === precreatedInstance?.id) || selectEgg();
    const mutation =
      config.mutations.find((e) => e.id === precreatedInstance?.mutation) ||
      (stats.money < 0
        ? config.mutations.find((m) => m.id === "none")!
        : selectMutation());
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

    if (await get("deleteEggs"))
      setTimeout(() => {
        sprite.destroy();
        stats.eggs.total--;
        stats.eggs[egg.id]--;
        instances.delete(instance);
        mutationTooltip.onPointerOut();
        updateTotal();

        // Destroy the egg after 60 seconds to save space
      }, 60000);

    sprite.eventMode = "static";
    sprite.on("pointertap", () => {
      sprite.destroy();
      stats.eggs.total--;
      stats.eggs[egg.id]--;
      stats.money += price;
      instances.delete(instance);
      mutationTooltip.onPointerOut();
      updateTotal();

      if (stats.money < 0) {
        if (!alertedDebt) {
          new Alert(
            `Uh oh! You're in debt!`,
            `Your credit score will decrease for every egg
you make during debt, which also affects future
eggs until you can bring it back up. Mutations
will also be disabled till you can remove your
debt.`,
            "text",
          );
          alertedDebt = true;
        }

        stats.creditScore = Math.min(
          850,
          Math.max(300, stats.creditScore - random(8, 20)),
        );

        updateTotal();
      } else {
        if (price - egg.price > 0) {
          stats.creditScore = Math.min(
            850,
            Math.max(300, stats.creditScore + random(8, 12)),
          );

          updateTotal();
        } else if (price - egg.price < 0) {
          stats.creditScore = Math.min(
            850,
            Math.max(300, stats.creditScore - random(4, 16)),
          );

          updateTotal();
        }
        alertedDebt = false;
      }
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

    sprite.on("rightclick", (e) => {
      e.preventDefault();
      sprite.destroy();
      stats.eggs.total--;
      stats.eggs[egg.id]--;
      instances.delete(instance);
      mutationTooltip.onPointerOut();
      updateTotal();
    });

    app.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    stats.eggs.total++;
    stats.eggs[egg.id]++;
    updateTotal();

    app.stage.addChild(sprite);

    return sprite;
  };

  // Load saved instances
  if (instances.size > 0) {
    for (const instance of instances) {
      await makeEgg(instance);
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
      {
        id: "delete-eggs",
        name: `Delete Eggs`,
        default: false,
        desc: `Delete eggs after 60 seconds. This will not claim it as money.`,
        type: "checkbox",
        async onChange(el) {
          if (el.checked) {
            await set("deleteEggs", true);
          } else {
            await set("deleteEggs", false);
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
    const close = document.querySelector(
      `#settings-menu-close`,
    ) as HTMLButtonElement;
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
          await setting.onLoad?.(input);
          await setting.onChange?.(input);
          await set("settings", settingOptions);
        });
      } else if (setting.type === "text") {
        input.type = "text";
        input.value = String(option.val);
        input.addEventListener("change", async () => {
          option.val = input.value;
          await setting.onLoad?.(input);
          await setting.onChange?.(input);
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

      close.addEventListener("click", () => menu.close());

      menu.appendChild(div);
    }

    btn.addEventListener("click", () => {
      menu.showModal();
    });

    // Tutorial
    {
      const tutorial = async () => {
        const tour = driver({
          showProgress: true,
          showButtons: [],

          onDestroyed: () => {
            document.addEventListener("keyup", (e) => {
              if (e.code === "KeyE") makeEgg();
            });
            {
              const el = document.querySelector(
                `#generate-egg`,
              ) as HTMLButtonElement;
              el.addEventListener("click", () => makeEgg());
            }
          },
          steps: [
            {
              element: `#generate-egg`,
              popover: {
                title: `Generate An Egg`,
                description: `Press Generate Egg or press E.`,
                showButtons: [],
              },
              onHighlighted: (untypedEl) => {
                const el = untypedEl as HTMLButtonElement;

                el.addEventListener("click", handleAdvance);
                document.addEventListener("keyup", handleAdvance);
              },
              onDeselected: (untypedEl) => {
                const el = untypedEl as HTMLButtonElement;

                el.removeEventListener("click", handleAdvance);
                document.removeEventListener("keyup", handleAdvance);
              },
            },
            {
              element: `#pixi-container canvas`,
              popover: {
                title: `Collect An Egg`,
                description: `Click an egg to collect it.`,
                showButtons: [],
              },
              onHighlighted: () => {
                handleAdvance = async () => {
                  tour.moveNext();
                };

                egg1.removeAllListeners("rightclick");

                app.canvas.addEventListener("contextmenu", (e) => {
                  e.preventDefault();
                });

                egg1.on("pointertap", () => {
                  (handleAdvance as any)();
                });
              },
            },
            {
              element: `#generate-egg`,
              popover: {
                title: `Generate Another Egg`,
                description: `Press Generate Egg or press E for another egg.`,
                showButtons: [],
              },
              onHighlighted: (untypedEl) => {
                const el = untypedEl as HTMLButtonElement;

                handleAdvance = async (e: MouseEvent | KeyboardEvent) => {
                  if (
                    e.type === "click" ||
                    ("code" in e && e.code === "KeyE")
                  ) {
                    egg2 = await makeEgg({
                      id: "brown",
                      mutation: "none",
                      x: app.canvas.width / 2,
                      y: app.canvas.height / 2,
                    });
                    tour.moveNext();
                  }
                };

                el.addEventListener("click", handleAdvance);
                document.addEventListener("keyup", handleAdvance);
              },
              onDeselected: (untypedEl) => {
                const el = untypedEl as HTMLButtonElement;

                el.removeEventListener("click", handleAdvance);
                document.removeEventListener("keyup", handleAdvance);
              },
            },
            {
              element: `#pixi-container canvas`,
              popover: {
                title: `Destroy An Egg`,
                description: `Right-click an egg to destroy it.`,
                showButtons: [],
              },
              onHighlighted: () => {
                handleAdvance = async () => {
                  tour.moveNext();
                };

                egg2.removeAllListeners("pointertap");

                egg2.on("rightclick", () => {
                  (handleAdvance as any)();
                });
              },
            },
          ],
        });

        let egg1: Sprite;
        let egg2: Sprite;

        let handleAdvance = async (e: MouseEvent | KeyboardEvent) => {
          if (e.type === "click" || ("code" in e && e.code === "KeyE")) {
            egg1 = await makeEgg({
              id: "brown",
              mutation: "none",
              x: app.canvas.width / 2,
              y: app.canvas.height / 2,
            });
            tour.moveNext();
          }
        };

        tour.drive();

        await set("tutorialFinished", true);
      };

      document.querySelector(`#tutorial`)!.addEventListener("click", tutorial);

      if (!(await get("tutorialFinished"))) {
        await tutorial();
      }
    }

    const cheatMode = () => {
      return {
        makeEgg,
        settings,
        updateTotal,
        config,
        stats,
        selectEgg,
        selectMutation,
        saveGame,
        wipeSave,
      };
    };

    (window as any).Gulcheat = cheatMode;
    (window as any).cheatGul = async () => {
      alert(`Guess you didn't realize the 'Gul' stood for gullible!`);
      alert(`Also go fuck yourself`);
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
