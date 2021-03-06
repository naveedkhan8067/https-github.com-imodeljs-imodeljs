/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module Widget */

import * as React from "react";

import { WidgetChangeHandler } from "../frontstage/FrontstageComposer";
import { Icon } from "../shared/IconComponent";
import { UiShowHideManager } from "../utils/UiShowHideManager";

import {
  Stacked as NZ_StackedWidget, HorizontalAnchor, VerticalAnchor,
  ResizeHandle, Tab, TabGroup, PointProps, TabSeparator, WidgetZoneIndex, TabMode, HandleMode, Rectangle,
} from "@bentley/ui-ninezone";
import { CommonProps } from "@bentley/ui-core";

/** Properties for a [[StackedWidget]] Tab.
 * @internal
 */
export interface WidgetTabProps {
  isActive: boolean;
  iconSpec?: string | React.ReactNode;
  title: string;
  widgetName: string;
}

/** Properties for a Widget in a [[StackedWidget]].
 * @internal
 */
export interface EachWidgetProps {
  id: WidgetZoneIndex;
  tabs: WidgetTabProps[];
  isStatusBar: boolean;
}

/** Properties for the [[StackedWidget]] React component.
 * @internal
 */
export interface StackedWidgetProps extends CommonProps {
  contentRef: React.RefObject<HTMLDivElement>;
  fillZone: boolean;
  isFloating: boolean;
  zoneId: WidgetZoneIndex;
  widgets: EachWidgetProps[];
  widgetChangeHandler: WidgetChangeHandler;
  horizontalAnchor: HorizontalAnchor;
  verticalAnchor: VerticalAnchor;
  isDragged: boolean | undefined;
  lastPosition: PointProps | undefined;
  isUnmergeDrag: boolean;
}

/** Stacked Widget React component.
 * @internal
 */
export class StackedWidget extends React.Component<StackedWidgetProps> {
  private _widget = React.createRef<NZ_StackedWidget>();
  private _firstTabs = new Map<WidgetZoneIndex, Tab>();

  public render(): React.ReactNode {
    this._firstTabs.clear();
    const isWidgetOpen = this.props.widgets.some((w) => w.tabs.some((t) => t.isActive));

    let tabs: JSX.Element[] = new Array<JSX.Element>();
    for (let i = 0; i < this.props.widgets.length; i++) {
      const widget = this.props.widgets[i];
      const widgetTabs = this.getWidgetTabs(widget, isWidgetOpen);

      if (i !== 0)
        tabs.push(<TabSeparator key={i} />);

      if (widgetTabs.length > 1) {
        tabs.push(
          <TabGroup
            key={widget.id}
            anchor={this.props.horizontalAnchor}
            handle={this.getTabHandleMode(widget.id)}
          >
            {widgetTabs}
          </TabGroup>,
        );
      } else {
        tabs = tabs.concat(widgetTabs);
      }
    }

    return (
      <NZ_StackedWidget
        className={this.props.className}
        style={this.props.style}
        contentRef={this.props.contentRef}
        fillZone={this.props.fillZone}
        horizontalAnchor={this.props.horizontalAnchor}
        isDragged={this.props.isDragged}
        isFloating={this.props.isFloating}
        isOpen={isWidgetOpen}
        onResize={
          (x, y, handle, filledHeightDiff) => {
            this._handleOnWidgetResize(this.props.zoneId, x, y, handle, filledHeightDiff);
          }
        }
        ref={this._widget}
        tabs={tabs}
        verticalAnchor={this.props.verticalAnchor}
        onMouseEnter={UiShowHideManager.handleWidgetMouseEnter}
      />
    );
  }

  private getTabHandleMode(widgetId: WidgetZoneIndex) {
    if (this.props.isUnmergeDrag && this.props.isDragged && widgetId === this.props.zoneId)
      return HandleMode.Visible;

    if (this.props.widgets.length > 1)
      return HandleMode.Hovered;

    return HandleMode.Timedout;
  }

  private getWidgetTabs(stackedWidget: EachWidgetProps, isWidgetOpen: boolean): JSX.Element[] {
    return stackedWidget.tabs.map((tab: WidgetTabProps, index: number) => {
      const mode = !isWidgetOpen ? TabMode.Closed : tab.isActive ? TabMode.Active : TabMode.Open;
      return (
        <Tab
          title={tab.title}
          key={`${stackedWidget.id}_${index}`}
          anchor={this.props.horizontalAnchor}
          mode={mode}
          lastPosition={this.props.lastPosition}
          onClick={() => this._handleWidgetTabClick(stackedWidget.id, index)}
          onDragStart={(initialPosition) => this._handleTabDragStart(stackedWidget.id, index, initialPosition, stackedWidget.isStatusBar)}
          onDrag={this._handleWidgetTabDrag}
          onDragEnd={this._handleTabDragEnd}
          ref={(instance: Tab | null) => this._handleTabRef(stackedWidget.id, index, instance)}
        >
          <Icon iconSpec={tab.iconSpec} />
        </Tab>
      );
    });
  }

  private _handleTabRef = (widgetId: WidgetZoneIndex, tabId: number, instance: Tab | null) => {
    if (tabId !== 0 || instance === null)
      return;

    this._firstTabs.set(widgetId, instance);
  }

  private _handleTabDragStart = (widgetId: WidgetZoneIndex, tabId: number, initialPosition: PointProps, isStatusBar: boolean) => {
    const firstTab = this._firstTabs.get(widgetId);
    if (!this._widget.current || !firstTab)
      return;

    const firstTabPos = Rectangle.create(firstTab.getBounds()).topLeft();
    const widgetPos = Rectangle.create(this._widget.current.getBounds()).topLeft();
    const offset = widgetPos.getOffsetTo(firstTabPos);

    this.props.widgetChangeHandler.handleTabDragStart(widgetId, tabId, initialPosition, offset);
    if (isStatusBar)
      this.props.widgetChangeHandler.handleTabDragEnd();
  }

  private _handleTabDragEnd = () => {
    this.props.widgetChangeHandler.handleTabDragEnd();
  }

  private _handleOnWidgetResize = (zoneId: WidgetZoneIndex, x: number, y: number, handle: ResizeHandle, filledHeightDiff: number) => {
    this.props.widgetChangeHandler.handleResize(zoneId, x, y, handle, filledHeightDiff);
  }

  private _handleWidgetTabClick = (widgetId: WidgetZoneIndex, tabIndex: number) => {
    this.props.widgetChangeHandler.handleTabClick(widgetId, tabIndex);
  }

  private _handleWidgetTabDrag = (dragged: PointProps) => {
    this.props.widgetChangeHandler.handleTabDrag(dragged);
  }
}
