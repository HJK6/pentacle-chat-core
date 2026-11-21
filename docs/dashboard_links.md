# Design links

Import `parseDashboardLinkEvent`, `buildDesignPath`, `DashboardLink`, `DesignTarget` and `DesignPresentation` from the package entry point.

`parseDashboardLinkEvent(event: unknown): DashboardLink | null` reads `raw.dashboard_link` for `dashboard: "design"`. A null result leaves the caption and attachments in the ordinary transcript. A parsed link with an omitted `target` opens Design Home. A present target contains `project_id`, `design_id` and optionally `view_id`. Each ID matches `^[a-z0-9][a-z0-9-]{0,79}$`. Present null values, invalid IDs and other target keys invalidate the link.

`buildDesignPath(target: DesignTarget | undefined, presentation: DesignPresentation): string | null` uses the caller’s `'workspace'` or `'embed'` selection. The root is `/next/design` or `/next/embed/design` respectively. Home uses the root alone. A board adds `/<project>/<design>`, and a screen adds `/<view>`. The builder revalidates supplied IDs and returns null for invalid input. A client admitting a raw URL must check its exact spelling before any normalization.

The parser keeps nonblank trimmed `title` and `subtitle` strings and accepts `revision_id` only as 64 lowercase hexadecimal characters. Navigation opens the current revision. Clients use the pinned revision for preview media, fall back to the event attachment when the media is unavailable, and keep valid targets actionable with text when neither image can load. Use the event caption or `Design` when the title is absent.

Both clients can copy [the synthetic fixture](../tests/fixtures/dashboard_links_v1.json) byte-for-byte from the pinned upstream commit. Each `event_cases` row gives the expected parsed `link` and `paths` by presentation. `previews` supplies simulated image availability and the expected image source and title for the UI. A null image means a text preview. `rejected_paths` lists noncanonical raw spellings for each prefix. The workspace browser may strip a fragment from an incoming address before processing the path. The native URL admission policy rejects a fragment.
