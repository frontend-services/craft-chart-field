<?php

namespace chartfield\renderers;

use chartfield\models\ChartData;

interface ChartRendererInterface
{
    /** Machine-readable handle, e.g. 'highcharts' */
    public function getHandle(): string;

    /** Human-readable name, e.g. 'HighCharts' */
    public function getName(): string;

    /** Whether this library requires a commercial license key */
    public function isCommercial(): bool;

    /** Array of chart type handles this renderer supports */
    public function getSupportedTypes(): array;

    /**
     * CDN or asset URLs needed to render charts.
     * Returns an array of script URLs to include.
     */
    public function getDefaultJsAssets(): array;

    /**
     * Translates canonical ChartData into the library-specific
     * configuration array (which will be JSON-encoded for the frontend).
     *
     * @param ChartData $data The canonical chart data
     * @param string|null $licenseKey License key from plugin settings (null if none set)
     */
    public function buildConfig(ChartData $data, ?string $licenseKey = null): array;

    /**
     * Returns an HTML string that renders the chart.
     * Includes the container element and the <script> initialization.
     *
     * @param string $containerId Unique DOM ID for the chart container
     * @param array $config Output of buildConfig()
     * @param array $options Width, height, class, etc.
     * @param array $jsAssets Resolved JS URLs to include (after CDN override logic)
     * @param string|null $licenseKey License key to inject into the init script
     */
    public function renderHtml(
        string $containerId,
        array $config,
        array $options = [],
        array $jsAssets = [],
        ?string $licenseKey = null
    ): string;
}
