<?php

namespace chartfield\assets;

use craft\web\AssetBundle;
use craft\web\assets\cp\CpAsset;

class FieldSettingsAsset extends AssetBundle
{
    public function init(): void
    {
        $this->sourcePath = __DIR__ . '/field-settings';

        $this->depends = [
            CpAsset::class,
        ];

        $this->js = [
            'FieldSettings.js',
        ];

        $this->css = [
            'field-settings.css',
        ];

        parent::init();
    }
}
