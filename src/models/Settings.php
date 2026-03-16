<?php

namespace chartfield\models;

use craft\base\Model;

class Settings extends Model
{
    /**
     * License keys for commercial charting libraries.
     * Keys are renderer handles, values are license key strings.
     * Supports environment variables via Craft::parseEnv().
     *
     * Example: ['highcharts' => '$HIGHCHARTS_LICENSE_KEY']
     */
    public array $licenseKeys = [];

    /**
     * Whether to load charting library JS from CDN automatically.
     * When true, render() includes <script> tags for the charting library.
     * When false, the developer must include the library themselves.
     */
    public bool $autoLoadJs = true;

    /**
     * Custom CDN URL overrides per library.
     * Keys are renderer handles, values are full URLs to the JS file.
     * If empty for a given library, the renderer's default CDN URL is used.
     *
     * Example: ['highcharts' => 'https://my-cdn.example.com/highcharts.js']
     */
    public array $cdnOverrides = [];

    /**
     * Color palettes available to content editors.
     * Keys are palette handles, values are arrays of hex color strings.
     * Override in config/chart-field.php to add, remove, or replace palettes.
     *
     * Example (config/chart-field.php):
     *   return [
     *       'palettes' => [
     *           'brand'   => ['#FF6B35', '#004E89', '#1A936F', '#C6D8AF'],
     *           'default' => ['#4A90D9', '#D94A4A', '#50C878', '#FFB347'],
     *       ],
     *   ];
     */
    public array $palettes = [
        'default'    => ['#4A90D9', '#D94A4A', '#50C878', '#FFB347', '#9B59B6', '#1ABC9C', '#E67E22', '#34495E'],
        'warm'       => ['#E74C3C', '#E67E22', '#F1C40F', '#D35400', '#C0392B', '#F39C12', '#E74C3C', '#D35400'],
        'cool'       => ['#3498DB', '#2ECC71', '#1ABC9C', '#9B59B6', '#2980B9', '#27AE60', '#16A085', '#8E44AD'],
        'monochrome' => ['#2C3E50', '#34495E', '#7F8C8D', '#95A5A6', '#BDC3C7', '#566573', '#ABB2B9', '#D5D8DC'],
        'pastel'     => ['#AED6F1', '#F9E79F', '#ABEBC6', '#F5B7B1', '#D7BDE2', '#A3E4D7', '#FAD7A0', '#D5DBDB'],
    ];

    public function defineRules(): array
    {
        return [
            [['licenseKeys', 'cdnOverrides', 'palettes'], 'safe'],
            [['autoLoadJs'], 'boolean'],
        ];
    }
}
