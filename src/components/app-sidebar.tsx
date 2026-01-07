import * as React from "react"
const LOGO_CX = 150
const LOGO_CY = 150

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  }
}

function createGenePath(opts: {
  startAngle: number
  lengthAngle: number
  tipLengthAngle: number
  R_in: number
  R_out: number
  flare: number
}) {
  const { startAngle, lengthAngle, tipLengthAngle, R_in, R_out, flare } = opts
  const R_mid = (R_in + R_out) / 2
  const shoulderAngle = startAngle + lengthAngle
  const tipAngle = shoulderAngle + tipLengthAngle

  const p1 = polarToCartesian(LOGO_CX, LOGO_CY, R_in, startAngle)
  const p2 = polarToCartesian(LOGO_CX, LOGO_CY, R_out, startAngle)
  const p3 = polarToCartesian(LOGO_CX, LOGO_CY, R_out, shoulderAngle)
  const p4 = polarToCartesian(LOGO_CX, LOGO_CY, R_out + flare, shoulderAngle)
  const p5 = polarToCartesian(LOGO_CX, LOGO_CY, R_mid, tipAngle)
  const p6 = polarToCartesian(LOGO_CX, LOGO_CY, R_in - flare, shoulderAngle)
  const p7 = polarToCartesian(LOGO_CX, LOGO_CY, R_in, shoulderAngle)

  const largeArcFlag = lengthAngle > 180 ? "1" : "0"

  return [
    `M ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${R_out} ${R_out} 0 ${largeArcFlag} 1 ${p3.x} ${p3.y}`,
    `L ${p4.x} ${p4.y}`,
    `L ${p5.x} ${p5.y}`,
    `L ${p6.x} ${p6.y}`,
    `L ${p7.x} ${p7.y}`,
    `A ${R_in} ${R_in} 0 ${largeArcFlag} 0 ${p1.x} ${p1.y}`,
    "Z",
  ].join(" ")
}

function PlasmidLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 300 300"
      role="img"
      aria-label="Plasmid logo"
    >
      <circle
        cx="150"
        cy="150"
        r="130"
        stroke="currentColor"
        strokeWidth={8}
        fill="none"
      />
      <g>
        <path
          d={createGenePath({
            startAngle: 10,
            lengthAngle: 90,
            tipLengthAngle: 8,
            R_in: 80,
            R_out: 148,
            flare: 11,
          })}
          fill="#F2748E"
        />
        <path
          d={createGenePath({
            startAngle: 120,
            lengthAngle: 60,
            tipLengthAngle: 8,
            R_in: 80,
            R_out: 148,
            flare: 11,
          })}
          fill="#BADB9A"
        />
        <path
          d={createGenePath({
            startAngle: 200,
            lengthAngle: 80,
            tipLengthAngle: 8,
            R_in: 80,
            R_out: 148,
            flare: 11,
          })}
          fill="#98D3C4"
        />
        <path
          d={createGenePath({
            startAngle: 300,
            lengthAngle: 40,
            tipLengthAngle: 8,
            R_in: 80,
            R_out: 148,
            flare: 11,
          })}
          fill="#D9DAD9"
        />
      </g>
    </svg>
  )
}

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Card, CardContent } from "@/components/ui/card"
import { PlasmidView } from "@/components/plasmid-view"

type ControlProps = {
  showLinks: boolean
  onToggleLinks: (value: boolean) => void
  showLabels: boolean
  onToggleLabels: (value: boolean) => void
  colorBy?: string
  colorOptions: string[]
  onChangeColorBy: (value?: string) => void
  pointSize: number
  onChangePointSize: (value: number) => void
  linkOpacity: number
  onChangeLinkOpacity: (value: number) => void
  hideNoMetadata: boolean
  onToggleHideNoMetadata: (value: boolean) => void
  hideIMGPR: boolean
  onToggleHideIMGPR: (value: boolean) => void
  plasmidId?: string | null
}

export function AppSidebar({
  showLinks,
  onToggleLinks,
  showLabels,
  onToggleLabels,
  colorBy,
  colorOptions,
  onChangeColorBy,
  pointSize,
  onChangePointSize,
  linkOpacity,
  onChangeLinkOpacity,
  hideNoMetadata,
  onToggleHideNoMetadata,
  hideIMGPR,
  onToggleHideIMGPR,
  plasmidId,
  ...props
}: React.ComponentProps<typeof Sidebar> & ControlProps) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="px-4 pt-5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-2 rounded-xl text-left"
            >
              <a href="#" className="flex items-center gap-3">
                <PlasmidLogo className="h-5 w-5 text-foreground" />
                <span className="text-base font-semibold tracking-tight">
                  Plasmid Defense Network
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="flex flex-1 flex-col justify-between pb-6">
        <div className="px-4 text-[0.7rem]">
          <Card className="border-muted/70 bg-card/70 text-[0.7rem]">
            <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Color by
                  </div>
                  <Select
                    value={colorBy ?? ""}
                    onValueChange={(v) => onChangeColorBy(v)}
                    disabled={!colorOptions.length}
                  >
                    
                   <SelectTrigger className="w-full justify-between text-[0.64rem]">
                    <SelectValue
                      placeholder="Choose a column"
                      className="text-[0.6rem]"
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {colorOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Visualization Settings
                </div>
                <div className="space-y-3 text-[0.68rem]">
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <div className="text-[0.64rem] font-semibold tracking-wide uppercase">
                      Show links
                    </div>
                    <p className="text-[0.6rem] text-muted-foreground">
                      Toggle edges for context
                    </p>
                  </div>
                  <Switch
                    aria-label="Toggle links"
                    checked={showLinks}
                    onCheckedChange={(v) => onToggleLinks(v)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <div className="text-[0.64rem] font-semibold tracking-wide uppercase">
                      Show labels
                    </div>
                    <p className="text-[0.6rem] text-muted-foreground">
                      Display node identifiers
                    </p>
                  </div>
                  <Switch
                    aria-label="Toggle labels"
                    checked={showLabels}
                    onCheckedChange={(v) => onToggleLabels(v)}
                  />
                </div>
            <div className="space-y-2 rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-[0.64rem] font-semibold tracking-wide uppercase">
                  Point size
                </div>
                <span className="text-[0.6rem] text-muted-foreground">{pointSize.toFixed(1)}</span>
              </div>
              <Slider
                min={1}
                max={50}
                step={0.5}
                value={[pointSize]}
                onValueChange={([v]) => onChangePointSize(v)}
              />
            </div>
            <div className="space-y-2 rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-[0.64rem] font-semibold tracking-wide uppercase">
                  Link opacity
                </div>
                <span className="text-[0.6rem] text-muted-foreground">
                  {linkOpacity.toFixed(2)}
                </span>
              </div>
              <Slider
                min={0.05}
                max={1}
                step={0.05}
                value={[linkOpacity]}
                onValueChange={([v]) => onChangeLinkOpacity(v)}
              />
            </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <div className="text-[0.64rem] font-semibold tracking-wide uppercase">
                      Hide empty metadata
                    </div>
                    <p className="text-[0.6rem] text-muted-foreground">
                      Hide nodes with empty values in selected column
                    </p>
                  </div>
                  <Switch
                    aria-label="Hide nodes without metadata"
                    checked={hideNoMetadata}
                    onCheckedChange={(v) => onToggleHideNoMetadata(v)}
                    disabled={!colorBy}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <div className="text-[0.64rem] font-semibold tracking-wide uppercase">
                      Hide IMGPR plasmids
                    </div>
                    <p className="text-[0.6rem] text-muted-foreground">
                      Hide plasmids from IMG/PR database
                    </p>
                  </div>
                  <Switch
                    aria-label="Hide IMGPR plasmids"
                    checked={hideIMGPR}
                    onCheckedChange={(v) => onToggleHideIMGPR(v)}
                  />
                </div>
          </div>
        </CardContent>
      </Card>
          <PlasmidView plasmidId={plasmidId} className="mt-4" />
        </div>
      </SidebarContent>
      <SidebarFooter className="hidden" />
    </Sidebar>
  )
}
