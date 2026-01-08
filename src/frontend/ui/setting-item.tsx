import React from 'react'

interface SettingItemProps {
  isFirstItem: boolean;
  isLastItem: boolean;
  settingItemName?: string;
  className?: string;


}

function SettingItem({ isFirstItem, isLastItem, className, settingItemName }: SettingItemProps) {
  return (
    <div className={ `${className || 'rounded-full'} ${isFirstItem ? "rounded-tr-[10px] rounded-tl-[10px]" : isLastItem ? "rounded-br-[10px] rounded-bl-[10px]" : ""}
    ${'bg-red-600 p-[10px]'}`}
    >
      {settingItemName}
    </div>
  )
}

export default SettingItem