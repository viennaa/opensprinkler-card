import { LitElement, css, html, TemplateResult } from 'lit';
import { customElement, state, property } from "lit/decorators";
import { HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import { PropertyValues } from 'lit-element';
import { UnsubscribeFunc } from 'home-assistant-js-websocket';

import { fillConfig, TimerBarEntityRow } from 'lovelace-timer-bar-card/src/timer-bar-entity-row';
import { EntityRegistryEntry, subscribeEntityRegistry } from './ha_entity_registry';
import { OpensprinklerCardConfig, HassEntity } from './types';
import { styles } from './styles';
import "./editor";
import "./opensprinkler-generic-entity-row";
import "./opensprinkler-more-info-dialog";
import "./opensprinkler-control";
import { MoreInfoDialog } from './opensprinkler-more-info-dialog';
import { EntitiesFunc, hasManual, hasRunOnce, isPlayPausable, isProgram, isStation, lineHeight, osName, stateActivated, stateWaiting } from './helpers';
import { renderState } from './opensprinkler-state';
import { styleMap } from 'lit/directives/style-map';

// This puts your card into the UI card picker dialog
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'opensprinkler-card',
  name: 'Opensprinkler Card',
  description: 'Collect OpenSprinkler status into a card',
});

window.customElements.define('opensprinkler-timer-bar-entity-row', TimerBarEntityRow);

@customElement('opensprinkler-card')
export class OpensprinklerCard extends LitElement {

  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config!: OpensprinklerCardConfig;
  @state() private entities?: EntityRegistryEntry[];
  @state() private unsub?: UnsubscribeFunc;
  @state() private dialog!: MoreInfoDialog;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    return document.createElement('opensprinkler-card-editor') as LovelaceCardEditor;
  }

  public static getStubConfig(): object {
    return {};
  }

  setConfig(config: OpensprinklerCardConfig): void {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    this.config = {
      name: "Sprinkler",
      icon: "mdi:sprinkler-variant",
      card_line_height: "small",
      timer_line_height: "medium",
      popup_line_height: "small",
      ...config,
      icons: {
        run_once: 'mdi:auto-fix',
        ...config.icons,
        station: {
          active: 'mdi:water',
          active_disabled: 'mdi:water-off',
          idle: 'mdi:water-outline',
          idle_disabled: 'mdi:water-off-outline',
          ...config.icons?.station,
        },
        program: {
          active: 'mdi:timer',
          active_disabled: 'mdi:timer-off',
          idle: 'mdi:timer-outline',
          idle_disabled: 'mdi:timer-off-outline',
          ...config.icons?.station,
        }
      }
    };
  }

  protected render(): TemplateResult | void {
    if (!this.config.device) return html`<hui-warning>No device specified</hui-warning>`;
    if (this.config.input_number && !this.config.input_number.entity) return html`<hui-warning>input_number.entity must be defined</hui-warning>`;
    if (!this.entities) return html``;

    const config = { name: this.config.name, icon: this.config.icon, title: true };
    const entities = this._statusEntities();
    const style = styleMap({
      '--opensprinkler-line-height': lineHeight(this.config.card_line_height),
      '--opensprinkler-timer-height': lineHeight(this.config.timer_line_height),
    });

    return html`<ha-card style=${style}>
      <div class="card-content">
        <opensprinkler-generic-entity-row
          .hass=${this.hass} .config=${config}
          .secondaryText=${this._secondaryText()}
          @hass-more-info=${this._moreInfo}
        ></opensprinkler-generic-entity-row>
        <div .style=${entities.length ? 'margin-top: 12px' : ''}>
          ${entities.map(s => this._renderStatus(s))}
        </div>
          ${ (this.config as any).card_stations ? html`<hui-warning>card_stations has been renamed to extra_entities</hui-warning>` : ''}
          ${this.config.extra_entities ?.length ? html`<div class="extras">
          ${this.config.input_number ? renderState(this.config.input_number, this.hass!) : ''}
          ${this._renderExtraEntities()}
        </div>` : ''}
      </div>
    </ha-card>
    `;
  }

  private _moreInfo() {
    this.dialog.showDialog({ config: this.config });
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config) return false;
    if (changedProps.has('config')) return true;

    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;
    if (!oldHass) return true;

    for (const entity of this._matchingEntities(() => true)) {
      if (oldHass.states[entity.entity_id] !== entity) return true;
    }

    const input = this.config.input_number?.entity;
    if (input && oldHass.states[input] !== this.hass?.states[input]) return true;

    return false;
  }

  public connectedCallback() {
    super.connectedCallback();
    if (this.hass) this._subscribe();

    this.dialog = new MoreInfoDialog();
    this.dialog.hass = this.hass!;
    this.dialog.entities = this._matchingEntities.bind(this);
    this.dialog.parent = this;
    document.body.appendChild(this.dialog);
  }

  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);
    if (!this.unsub && changedProps.has("hass")) {
      this._subscribe();
    }
    if (changedProps.has("hass")) this.dialog.hass = this.hass!;
  }

  public disconnectedCallback() {
    super.disconnectedCallback();
    if (this.unsub) this.unsub();
    this.unsub = undefined;
    document.body.removeChild(this.dialog);
  }

  private _subscribe() {
    this.unsub = subscribeEntityRegistry(this.hass!.connection, entries => {
      this.entities = entries;
    });
  }

  private _matchingEntities(predicate: (entity: any) => boolean) {
    if (!this.entities || !this.hass) return [];
    const entities = this.entities.filter(e => {
      const state = this.hass!.states[e.entity_id];
      if (!state) return;
      return e.device_id === this.config.device && predicate(state);
    });
    return entities.map(e => this.hass!.states[e.entity_id]);
  }

  private _statusEntities() {
    const status = this._matchingEntities(isStation);
    return status.filter(stateActivated).concat(status.filter(stateWaiting));
  }

  private _renderStatus(e: HassEntity) {
    const config = fillConfig({
      // These two properties can be overridden
      icon: this.config.icons.station.idle,
      active_icon: this.config.icons.station.active,

      ...this.config.bars,

      type: 'timer-bar-entity-row',
      entity: e.entity_id,
      name: e.attributes.name,
    });
    return html`<opensprinkler-timer-bar-entity-row
      .config=${config} .hass=${this.hass}>
    </opensprinkler-timer-bar-entity-row>`;
  }

  private _renderExtraEntities() {
    if (!this.config.extra_entities) return '';
    return this.config.extra_entities.map(e => {
      if (!e.includes('.')) return html`<div role="heading" class="header">${e}</div>`;
      if (!this.hass!.states[e]) return html`<hui-warning>Entity ${e} not found</hui-warning>`;
      if (!isPlayPausable(this.hass!.states[e])) return renderState(e, this.hass!);
      return html`<opensprinkler-control .entity=${this.hass!.states[e]}
                   .entities=${p => this._matchingEntities(p)} .hass=${this.hass}
                   .config=${this.config}
                ></opensprinkler-control>`;
    });
  }

  private _secondaryText() {
    const entities: EntitiesFunc = p => this._matchingEntities(p)

    const programs = entities(isProgram).filter(stateActivated).map(osName);
    if (hasRunOnce(entities)) programs.splice(0, 0, 'Once Program');
    if (hasManual(entities)) programs.push('Stations Manually');

    if (programs.length > 0) return 'Running ' + programs.join(', ');
    return '';
  }

  public async getCardSize(): Promise<number> {
    return 1 + this._statusEntities().length;
  }

  static styles = [styles, css`.header { margin-top: 8px; }`];
}
