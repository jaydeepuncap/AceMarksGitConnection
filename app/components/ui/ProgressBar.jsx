import React from 'react';

const ProgressBar = ({
    progress,
    tone = "success",
    size = "medium"
}) => {

    const progressValue = typeof progress === 'string'
        ? parseFloat(progress) || 0
        : Number(progress) || 0;

    const percentage = Math.min(100, Math.max(0, progressValue));

    const sizeStyles = {
        small: { height: '6px', borderRadius: '3px' },
        medium: { height: '8px', borderRadius: '4px' },
        large: { height: '12px', borderRadius: '6px' }
    };

    const toneColors = {
        success: '#29845a',
        warning: '#ffa500',
        danger: '#ff0000',
        info: '#3498db',
        neutral: '#e0e0e0'
    };

    const barColor = toneColors[tone] || toneColors.success;

    return (
        <div className="progress-contain" style={{ width: '100%' }}>
            <div
                className="pc-graph-bg"
                style={{
                    width: '100%',
                    height: sizeStyles[size]?.height || '8px',
                    backgroundColor: '#f5f5f5',
                    borderRadius: sizeStyles[size]?.borderRadius || '4px',
                    overflow: 'hidden'
                }}
            >
                <div
                    className="pc-graph-bg-rating"
                    style={{
                        width: `${percentage}%`,
                        height: '100%',
                        backgroundColor: barColor,
                        transition: 'width 0.3s ease-in-out'
                    }}
                />
            </div>
        </div>
    );
};

export default ProgressBar;