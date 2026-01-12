import { LucideIcon } from 'lucide-react'

interface PersonalityButtonProps {
  name: string;
  description: string;
  icon: LucideIcon;
  isSelected: boolean;
  onClick: () => void;
  isFirstItem: boolean;
  isLastItem: boolean;
}

function PersonalityButton({ name, description, icon: Icon, isSelected, onClick, isFirstItem, isLastItem }: PersonalityButtonProps) {
  const roundedClasses = isFirstItem
    ? 'rounded-tr-[16px] rounded-tl-[16px] rounded-bl-[5px] rounded-br-[5px]'
    : isLastItem
    ? 'rounded-br-[16px] rounded-bl-[16px] rounded-tl-[5px] rounded-tr-[5px]'
    : 'rounded-[5px]';

  return (
    <button
      onClick={onClick}
      className={`w-full p-[10px] px-[16px] min-h-[56px] ${roundedClasses} transition-all duration-200 text-left flex items-center justify-between gap-3`}
      style={{
        backgroundColor: isSelected ? 'rgba(128, 128, 128, 0.15)' : 'var(--primary-foreground)',
        border: isSelected ? '1px solid rgba(128, 128, 128, 0.3)' : '1px solid transparent',
      }}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex-shrink-0">
          <Icon size={20} style={{ color: 'var(--secondary-foreground)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold" style={{ color: 'var(--secondary-foreground)' }}>
            {name}
          </div>
          <div className="text-[9px] truncate" style={{ color: 'var(--text-secondary)' }}>
            {description}
          </div>
        </div>
      </div>
      <div className="flex-shrink-0">
        <div
          className="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
          style={{
            borderColor: isSelected ? 'var(--secondary-foreground)' : 'rgba(128, 128, 128, 0.3)',
            backgroundColor: isSelected ? 'var(--secondary-foreground)' : 'transparent',
          }}
        >
          {isSelected && (
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--primary-foreground)' }} />
          )}
        </div>
      </div>
    </button>
  )
}

export default PersonalityButton
