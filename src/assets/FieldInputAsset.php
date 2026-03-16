<?php

namespace chartfield\assets;

use craft\web\AssetBundle;
use craft\web\assets\cp\CpAsset;

class FieldInputAsset extends AssetBundle
{
    public function init(): void
    {
        $this->sourcePath = __DIR__ . '/field-input';

        $this->depends = [
            CpAsset::class,
        ];

        $this->js = [
            'ChartTableEditor.js',
            'FieldInput.js',
        ];

        $this->css = [
            'field-input.css',
        ];

        parent::init();
    }
}
