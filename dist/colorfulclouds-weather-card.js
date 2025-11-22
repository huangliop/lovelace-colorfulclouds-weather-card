console.info(
  "%c  WEATHER CARD  \n%c  Version 2.0.2 (Debug Mode) ",
  "color: orange; font-weight: bold; background: black",
  "color: white; font-weight: bold; background: dimgray"
);

// 1. 定义LitElement获取方式，增加容错
let LitElement;
try {
  LitElement = customElements.get("home-assistant-main")
    ? Object.getPrototypeOf(customElements.get("home-assistant-main"))
    : Object.getPrototypeOf(customElements.get("hui-view"));
} catch (e) {
  // 备用方案
  LitElement = Object.getPrototypeOf(customElements.get("ha-panel-lovelace") || document.createElement("div"));
}

const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

const windDirections = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW", "N",
];
const skycon2cn = {
  CLEAR_DAY: "晴",
  CLEAR_NIGHT: "晴",
  PARTLY_CLOUDY_DAY: "多云",
  PARTLY_CLOUDY_NIGHT: "多云",
  CLOUDY: "阴",
  LIGHT_HAZE: "轻度雾霾",
  MODERATE_HAZE: "中度雾霾",
  HEAVY_HAZE: "重度雾霾",
  LIGHT_RAIN: "小雨",
  MODERATE_RAIN: "中雨",
  HEAVY_RAIN: "大雨",
  STORM_RAIN: "暴雨",
  FOG: "雾",
  LIGHT_SNOW: "小雪",
  MODERATE_SNOW: "中雪",
  HEAVY_SNOW: "大雪",
  STORM_SNOW: "暴雪",
  DUST: "浮尘",
  SAND: "沙尘",
  WIND: "大风",
};

const fireEvent = (node, type, detail, options) => {
  options = options || {};
  detail = detail === null || detail === undefined ? {} : detail;
  const event = new Event(type, {
    bubbles: options.bubbles === undefined ? true : options.bubbles,
    cancelable: Boolean(options.cancelable),
    composed: options.composed === undefined ? true : options.composed,
  });
  event.detail = detail;
  node.dispatchEvent(event);
  return event;
};

function hasConfigOrEntityChanged(element, changedProps) {
  if (changedProps.has("_config")) return true;
  const oldHass = changedProps.get("hass");
  if (oldHass) {
    return (
      oldHass.states[element._config.entity] !== element.hass.states[element._config.entity] ||
      oldHass.states["sun.sun"] !== element.hass.states["sun.sun"]
    );
  }
  return true;
}

class WeatherCard extends LitElement {
  static get properties() {
    return {
      _config: {},
      _hass: {},
      showTarget: 0,
      hourly: [],
      daily: [],
    };
  }

  static getConfigElement() {
    return document.createElement("colorfulclouds-weather-card-editor");
  }

  static getStubConfig() {
    return {
      entity: null,
      show_houer: true,
      show_daily: true,
      show_realtime: true,
      icon: "/hacsfiles/lovelace-colorfulclouds-weather-card/icons/animated/",
    };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define a weather entity");
    }
    this._config = config;
    this.showTarget = 0;
    this._last_updated = null;
    this.tempMAX = null;
    this.tempMIN = null;
    this.tempCOLOR = [];
  }

  set hass(hass) {
    if (this._config.entity === "none") return;
    this._hass = hass;
    const stateObj = this._hass.states[this._config.entity];
    if (!stateObj) return;

    const last_updated = new Date(stateObj.last_updated).getTime();
    this._attributes = stateObj.attributes;
    
    if (last_updated !== this._last_updated) {
      // === 获取每日预报 ===
      if (this._config.show_daily) {
        this._hass
          .callWS({
            type: "call_service",
            domain: "weather",
            service: "get_forecasts",
            service_data: { type: "daily" },
            target: { entity_id: [this._config.entity] },
            return_response: true,
          })
          .then((response) => {
            // 兼容性修复：处理不同版本的返回结构
            let resultData = response;
            if (response && response.response) {
                resultData = response.response;
            }
            
            if (resultData && resultData[this._config.entity]) {
                this.daily = resultData[this._config.entity].forecast;
                // console.log("[ColorfulClouds] Daily loaded:", this.daily);
            } else {
                console.warn("[ColorfulClouds] Daily data structure mismatch:", response);
            }
          })
          .catch(err => console.error("[ColorfulClouds] Daily forecast failed:", err));
      }
      
      // === 获取小时预报 ===
      if (this._config.show_houer) {
        this._hass
          .callWS({
            type: "call_service",
            domain: "weather",
            service: "get_forecasts",
            service_data: { type: "hourly" },
            target: { entity_id: [this._config.entity] },
            return_response: true,
          })
          .then((response) => {
            let resultData = response;
            if (response && response.response) {
                resultData = response.response;
            }

            if(!resultData || !resultData[this._config.entity]) {
                console.warn("[ColorfulClouds] Hourly data not found");
                return;
            }
            
            const hourly = resultData[this._config.entity].forecast;
            this.hourly = hourly;
            
            if (hourly && hourly.length > 0) {
                this.tempMAX = hourly[0].temperature;
                this.tempMIN = hourly[0].temperature;

                hourly.forEach((item) => {
                  this.tempMAX = Math.max(this.tempMAX, item.temperature);
                  this.tempMIN = Math.min(this.tempMIN, item.temperature);
                });
                
                this.tempCOLOR = [];
                hourly.map((item) =>
                  this.tempCOLOR.push(
                    Math.round(255 * ((item.temperature - this.tempMIN) / (this.tempMAX - this.tempMIN))) + "," +
                    Math.round(66 + 150 * (1 - (item.temperature - this.tempMIN) / (this.tempMAX - this.tempMIN))) + "," +
                    Math.round(255 * (1 - (item.temperature - this.tempMIN) / (this.tempMAX - this.tempMIN)))
                  )
                );
            }
            
            this._last_updated = last_updated;
            this.updateComplete.then(() => {
              this._adjustScrollPosition();
            });
          })
          .catch(err => console.error("[ColorfulClouds] Hourly forecast failed:", err));
      }
    }
  }

  shouldUpdate(changedProps) {
    return hasConfigOrEntityChanged(this, changedProps);
  }

  render() {
    if (!this._config || !this._hass) return html``;
    
    // 错误检查
    if (this._config.entity === "none") return html`<ha-card><div style="padding:16px;">请配置实体</div></ha-card>`;
    const stateObj = this._hass.states[this._config.entity];
    if (!stateObj) return html`<ha-card><div style="padding:16px;">找不到实体: ${this._config.entity}</div></ha-card>`;

    const showdata = this.showTarget;
    const attributes = stateObj.attributes;
    // 确保 skycon 存在，防止报错
    const currentSkycon = attributes.skycon || "CLEAR_DAY";
    
    const iconUrl = this._config.icon || "/hacsfiles/lovelace-colorfulclouds-weather-card/icons/animated/";
    const lang = this._hass.selectedLanguage || this._hass.language;

    return html`
      ${this.renderStyle()}
      <ha-card>
        <div class="content">
          <div class="icon-image">
            <span style="background: none, url(${iconUrl}${currentSkycon}.svg) no-repeat; background-size: contain;"></span>
          </div>
          <div class="info">
            <div class="name-state">
              <div class="state">${skycon2cn[currentSkycon] || attributes.state}</div>
              <div class="name">${this._config.name || attributes.friendly_name}</div>
            </div>
            <div class="temp-attribute">
              <div class="temp">
                ${attributes.temperature}
                <span>${this.getUnit("temperature")}</span>
              </div>
              <div class="attribute">
                ${this._config.secondary_info_attribute ? html`
                    ${attributes[this._config.secondary_info_attribute]} ${this.getUnit(this._config.secondary_info_attribute)}
                ` : ""}
              </div>
            </div>
          </div>
        </div>

        ${this._config.show_realtime ? html`
            <div>
              <ul class="variations">
                <li>
                   <span class="ha-icon"><ha-icon icon="mdi:water-percent"></ha-icon></span>
                   ${attributes.humidity}<span class="unit">%</span>
                </li>
                <li>
                   <span class="ha-icon"><ha-icon icon="mdi:weather-windy"></ha-icon></span>
                   ${attributes.wind_speed}<span class="unit">${this.getUnit("length")}/h</span>
                </li>
                <li>
                   <span class="ha-icon"><ha-icon icon="mdi:gauge"></ha-icon></span>
                   ${Math.round(attributes.pressure)/100}<span class="unit">${this.getUnit("air_pressure")}</span>
                </li>
              </ul>
            </div>
        ` : ""}

        ${this.daily && this.daily.length > 0 && this._config.show_daily ? html`
              <div class="forecast clear" @scroll="${this._dscroll}">
                ${this.daily.map(
                  (d) => html`
                    <div class="day">
                      <span class="dayname">${this._today(d.datetime)}</span><br />
                      <br />
                      <i class="icon" style="background: none, url(${iconUrl}${d.skycon}.svg) no-repeat; background-size: contain;"></i>
                      <br /><span class="highTemp">${d.temperature}${this.getUnit("temperature")}</span>
                      ${d.templow !== undefined ? html`<br /><span class="lowTemp">${d.templow}${this.getUnit("temperature")}</span>` : ""}
                    </div>
                  `
                )}
              </div>
            `
          : html`<div style="text-align:center; font-size:12px; color:gray; padding:10px;">暂无每日预报数据</div>`}

        ${this.hourly && this.hourly.length > 0 && this._config.show_houer ? html`
              <div class="forecast clear hourly-forecast" @scroll="${this._hscroll}">
                ${this.hourly.map((h, i) => html`
                    <div class="hourly" style="position: relative;">
                      <span class="dayname ${new Date(h.datetime).getHours() === 12 ? "show" : ""}">${new Date(h.datetime).getHours()}</span>
                      <i class="icon" style="background: url(${iconUrl}${h.skycon}.svg) no-repeat; background-size: contain;"></i>
                      <span style="border-top-color: rgb(${this.tempCOLOR[i]});border-top-width:${((h.temperature - this.tempMIN)/(this.tempMAX - this.tempMIN))*7+3}px" class="dtemp">.</span>
                    </div>
                `)}
              </div>
            `
          : ""}
      </ha-card>
    `;
  }

  _dscroll(e) { /* 滚动同步逻辑简化，防止报错 */ }

  _adjustScrollPosition() {
      // 简化滚动定位，防止找不到元素报错
      try {
        const container = this.shadowRoot.querySelector('.hourly-forecast');
        if(container) container.scrollLeft = 0; 
      } catch(e){}
  }
  
  _hscroll(e) { /* 简化交互 */ }

  getUnit(measure) {
    const lengthUnit = this._hass.config.unit_system.length || "";
    switch (measure) {
      case "pressure": return lengthUnit === "km" ? "hPa" : "inHg";
      case "wind_speed": return `${lengthUnit}/h`;
      case "length": return lengthUnit;
      case "precipitation": return lengthUnit === "km" ? "mm" : "in";
      case "visibility": return lengthUnit;
      default: return this._hass.config.unit_system[measure] || "";
    }
  }

  _today(date) {
    const lang = this._hass.selectedLanguage || this._hass.language;
    const inDate = new Date(date);
    const nowDate = new Date();
    if (inDate.toDateString() === nowDate.toDateString()) {
      return "今天";
    }
    return inDate.toLocaleDateString(lang, { weekday: "short" });
  }

  renderStyle() {
    return html`
      <style>
        .forecast { width: 100%; margin: 0 auto; display: flex; overflow-x: auto; padding-bottom: 10px; }
        ha-card { margin: auto; padding: 1em; position: relative; }
        .content { display: flex; justify-content: space-between; align-items: center; }
        .icon-image > span { display:block; width: 74px; height: 74px; }
        .info { flex-grow: 1; text-align:right; }
        .state { font-size: 28px; line-height: 1.2; }
        .variations { display: flex; justify-content: space-between; list-style: none; padding: 0; margin-top: 1em; }
        .day { width: 20%; text-align: center; flex: none; border-right: 1px solid #eee; }
        .hourly { width: 25px; text-align: center; flex: none; }
        .icon { width: 40px; height: 40px; display: inline-block; }
        .hourly .icon { width: 25px; height: 25px; }
        .dtemp { display: block; border-top: solid 3px #fff; height: 35px; color: transparent; }
        /* 隐藏滚动条 */
        ::-webkit-scrollbar { height: 6px; }
        ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 3px; }
      </style>
    `;
  }
}
customElements.define("weather-card", WeatherCard);

// 简化版编辑器，防止旧元素报错
export class WeatherEditor extends LitElement {
  setConfig(config) { this.config = config; }
  static get properties() { return { hass: {}, config: {} }; }
  render() {
    return html`<div style="padding: 10px;">请使用 YAML 模式编辑此卡片配置。</div>`;
  }
}
customElements.define("colorfulclouds-weather-card-editor", WeatherEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "weather-card",
  name: "Colorfulclouds Weather",
  preview: true,
  description: "修复版彩云天气",
});
