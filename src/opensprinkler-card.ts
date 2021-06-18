import { LitElement, html, TemplateResult } from 'lit';
import { customElement, state, property } from "lit/decorators";
import { HomeAssistant, hasConfigOrEntityChanged, LovelaceCardEditor } from 'custom-card-helpers';
import { PropertyValues } from 'lit-element';
import { UnsubscribeFunc } from 'home-assistant-js-websocket';

import { fillConfig, TimerBarEntityRow } from 'timer-bar-card/src/timer-bar-entity-row';
import { EntityRegistryEntry, subscribeEntityRegistry } from './ha_entity_registry';
import type { OpensprinklerCardConfig, HassEntity } from './types';
import "./editor";
import "./opensprinkler-generic-entity-row";
import "./opensprinkler-more-info-dialog";
import { MoreInfoDialog } from './opensprinkler-more-info-dialog';
import { EntitiesFunc, hasManual, hasRunOnce, isProgram, isStation, osName, stateActivated, stateWaiting } from './helpers';

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
      ...config,
    };
  }

  protected render(): TemplateResult | void {
    if (!this.config.device) return html`<hui-warning>No device specified</hui-warning>`;
    if (!this.entities) return html``;

    const config = { name: this.config.name, icon: 'mdi:sprinkler-variant', title: true };
    const entities = this._statusEntities();

    return html`<ha-card>
      <div class="card-content">
        <opensprinkler-generic-entity-row
          .hass=${this.hass} .config=${config}
          .secondaryText=${this._secondaryText()}
          @hass-more-info=${this._moreInfo}
        ></opensprinkler-generic-entity-row>
        <div .style=${entities.length ? 'margin-top: 12px' : ''}>
          ${entities.map(s => this._renderStatus(s))}
        </div>
      </div>
    </ha-card>
    `;
  }

  private _moreInfo() {
    this.dialog.showDialog({ entityId: 'idk' });
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config) return false;
    if (this.config.entity) {
      return hasConfigOrEntityChanged(this, changedProps, false);
    }

    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;
    if (!oldHass) return true;

    for (const entity of this._matchingEntities(() => true)) {
      if (oldHass.states[entity.entity_id] !== entity) return true;
    }

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
    if (changedProps.has("config")) this.dialog.config = this.config;
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

  private _matchingEntities(predicate: (id: string) => boolean) {
    if (!this.entities || !this.hass) return [];
    const entities = this.entities.filter(e =>
      e.device_id === this.config.device && predicate(e.entity_id));
    return entities.map(e => this.hass!.states[e.entity_id]);
  }

  private _statusEntities() {
    const status = this._matchingEntities(isStation);
    return status.filter(stateActivated).concat(status.filter(stateWaiting));
  }

  private _renderStatus(e: HassEntity) {
    const config = fillConfig({
      type: 'timer-bar-entity-row',
      entity: e.entity_id,
      icon: 'mdi:water-outline',
      active_icon: 'mdi:water',
      name: e.attributes.name,
    });
    return html`<opensprinkler-timer-bar-entity-row
      .config=${config} .hass=${this.hass} style="height: 36px">
    </opensprinkler-timer-bar-entity-row>`;
  }

  private _secondaryText() {
    const entities: EntitiesFunc = p => this._matchingEntities(p)

    const programs = entities(isProgram).filter(stateActivated).map(osName);
    if (hasRunOnce(entities)) programs.splice(0, 0, 'Once Program');
    if (hasManual(entities)) programs.push('Stations Manually');

    if (programs.length > 0) return 'Running ' + programs.join(', ');
    return '';
  }
}
